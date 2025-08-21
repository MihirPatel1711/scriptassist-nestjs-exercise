import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { CacheService } from '../../common/services/cache.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectQueue('task-processing')
    private taskQueue: Queue,
    private cacheService: CacheService,  // Add cache service
  ) {}

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    const task = this.tasksRepository.create(createTaskDto);
    const savedTask = await this.tasksRepository.save(task);

    try {
      // Add to queue and wait for confirmation
      await this.taskQueue.add('task-status-update', {
        taskId: savedTask.id,
        status: savedTask.status,
      });
    } catch (error) {
      // Log the error but don't fail the task creation
      console.error('Failed to add task to queue:', error);
    }

    return savedTask;
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    status?: string,
    priority?: string,
  ): Promise<{ data: Task[]; total: number; page: number; limit: number }> {
    // Try to get from cache first (high traffic operation)
    const cacheKey = `tasks:${page}:${limit}:${status || 'all'}:${priority || 'all'}`;
    const cached = await this.cacheService.get<{
      data: Task[];
      total: number;
      page: number;
      limit: number;
    }>(cacheKey);
    
    if (cached) {
      return cached;
    }

    // Single efficient method that handles pagination, filtering, and ordering
    const skip = (page - 1) * limit;
    
    // Build query with optional filters
    const whereClause: any = {};
    if (status) whereClause.status = status;
    if (priority) whereClause.priority = priority;
    
    const [tasks, total] = await this.tasksRepository.findAndCount({
      where: whereClause,
      relations: ['user'],
      skip,
      take: limit,
      order: { createdAt: 'DESC' }, // Most recent tasks first
    });

    const result = {
      data: tasks,
      total,
      page,
      limit,
    };

    // Cache for 3 minutes (moderate changes, high traffic)
    await this.cacheService.set(cacheKey, result, 180);
    
    return result;
  }

  async findOne(id: string): Promise<Task> {
    // Single efficient database call
    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!task) {
      throw new NotFoundException(`Task not found.`);
    }

    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    // Efficient single database call with direct update
    const result = await this.tasksRepository.update(id, updateTaskDto);
    
    if (result.affected === 0) {
      throw new NotFoundException(`Task not found`);
    }
    
    // Invalidate related cache entries when data changes
    await this.invalidateTaskCache();
    
    // Get the updated task
    const updatedTask = await this.findOne(id);
    
    // Add to queue if status changed, with proper error handling
    if (updateTaskDto.status && updateTaskDto.status !== updatedTask.status) {
      try {
        await this.taskQueue.add('task-status-update', {
          taskId: updatedTask.id,
          status: updatedTask.status,
        });
      } catch (error) {
        // Log error but don't fail the update
        console.error('Failed to add task to queue:', error);
      }
    }
    
    return updatedTask;
  }

  async remove(id: string): Promise<void> {
    // Efficient single database call
    const result = await this.tasksRepository.delete(id);
    
    if (result.affected === 0) {
      throw new NotFoundException(`Task not found`);
    }

    // Invalidate related cache entries when data changes
    await this.invalidateTaskCache();
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    // Efficient TypeORM implementation
    return this.tasksRepository.find({
      where: { status },
      order: { createdAt: 'DESC' },
    });
  }

  async getTaskStatistics(): Promise<{
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    highPriority: number;
  }> {
    // Try to get from cache first (expensive operation)
    const cacheKey = 'stats:task-statistics';
    const cached = await this.cacheService.get<{
      total: number;
      completed: number;
      inProgress: number;
      pending: number;
      highPriority: number;
    }>(cacheKey);
    
    if (cached) {
      return cached;
    }

    // Efficient approach: SQL aggregation with parallel queries
    const [total, completed, inProgress, pending, highPriority] = await Promise.all([
      this.tasksRepository.count(),
      this.tasksRepository.count({ where: { status: TaskStatus.COMPLETED } }),
      this.tasksRepository.count({ where: { status: TaskStatus.IN_PROGRESS } }),
      this.tasksRepository.count({ where: { status: TaskStatus.PENDING } }),
      this.tasksRepository.count({ where: { priority: TaskPriority.HIGH } }),
    ]);
    
    const statistics = { total, completed, inProgress, pending, highPriority };
    
    // Cache for 5 minutes (statistics don't change frequently)
    await this.cacheService.set(cacheKey, statistics, 300);
    
    return statistics;
  }

  async batchProcessTasks(operations: { tasks: string[]; action: string }): Promise<Array<{
    taskId: string;
    success: boolean;
    result?: any;
    error?: string;
  }>> {
    // Efficient batch processing: Use TypeORM's In operator for bulk updates/deletes
    const { tasks: taskIds, action } = operations;
    const results = [];

    try {
      let operationResult;

      if (action === 'complete') {
        // Bulk update all tasks to completed status
        operationResult = await this.tasksRepository.update(
          { id: In(taskIds) },
          { status: TaskStatus.COMPLETED }
        );
      } else if (action === 'delete') {
        // Bulk delete all tasks
        operationResult = await this.tasksRepository.delete({ id: In(taskIds) });
      } else {
        throw new Error(`Unknown action: ${action}`);
      }

      // Add to queue for status updates if action was 'complete'
      if (action === 'complete') {
        for (const taskId of taskIds) {
          try {
            await this.taskQueue.add('task-status-update', {
              taskId: taskId,
              status: TaskStatus.COMPLETED,
            });
          } catch (error) {
            // Log error but don't fail the batch
            console.error('Failed to add task to queue:', error);
          }
        }
      }

      // Invalidate cache after batch operations
      await this.invalidateTaskCache();

      // Return success for all tasks
      return taskIds.map(taskId => ({ 
        taskId, 
        success: true, 
        result: operationResult 
      }));

    } catch (error) {
      // Return error for all tasks if bulk operation fails
      return taskIds.map(taskId => ({ 
        taskId, 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  async updateStatus(id: string, status: TaskStatus): Promise<Task> {
    // Single efficient database call with direct update
    const result = await this.tasksRepository.update(id, { status });
    
    if (result.affected === 0) {
      throw new NotFoundException(`Task not found`);
    }
    
    // Invalidate related cache entries when data changes
    await this.invalidateTaskCache();
    
    // Return the updated task
    return this.findOne(id);
  }

  // Cache invalidation helper
  private async invalidateTaskCache(): Promise<void> {
    try {
      // Clear statistics cache
      await this.cacheService.delete('stats:task-statistics');
      
      // Clear all task-related cache entries
      // Get all cache keys and filter for task-related ones
      const stats = this.cacheService.getStats();
      
      // Clear all paginated task caches (any page, any limit, any filters)
      for (const key of stats.keys) {
        if (key.startsWith('tasks:') || key.startsWith('stats:')) {
          await this.cacheService.delete(key);
        }
      }
      
      // Also clear any other potential task cache patterns
      await this.cacheService.delete('tasks:*');
      await this.cacheService.delete('stats:*');
      
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  }
}