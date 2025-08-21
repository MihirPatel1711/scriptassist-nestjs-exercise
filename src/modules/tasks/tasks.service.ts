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

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectQueue('task-processing')
    private taskQueue: Queue,
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
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const skip = (pageNum - 1) * limitNum;
    
    // Build query with optional filters
    const whereClause: any = {};
    if (status) whereClause.status = status;
    if (priority) whereClause.priority = priority;
    
    const [tasks, total] = await this.tasksRepository.findAndCount({
      where: whereClause,
      relations: ['user'],
      skip,
      take: limitNum,
      order: { createdAt: 'DESC' }, 
    });

    return {
      data: tasks,
      total,
      page: pageNum,
      limit: limitNum,
    };
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
    const result = await this.tasksRepository.delete(id);
    
    if (result.affected === 0) {
      throw new NotFoundException(`Task not found`);
    }
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
    // Efficient approach: SQL aggregation with parallel queries
    const [total, completed, inProgress, pending, highPriority] = await Promise.all([
      this.tasksRepository.count(),
      this.tasksRepository.count({ where: { status: TaskStatus.COMPLETED } }),
      this.tasksRepository.count({ where: { status: TaskStatus.IN_PROGRESS } }),
      this.tasksRepository.count({ where: { status: TaskStatus.PENDING } }),
      this.tasksRepository.count({ where: { priority: TaskPriority.HIGH } }),
    ]);
    
    return { total, completed, inProgress, pending, highPriority };
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
    
    // Return the updated task
    return this.findOne(id);
  }
}
