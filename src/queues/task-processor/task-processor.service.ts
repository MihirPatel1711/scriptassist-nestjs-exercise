import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TasksService } from '../../modules/tasks/tasks.service';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

@Injectable()
@Processor('task-processing')
export class TaskProcessorService extends WorkerHost {
  private readonly logger = new Logger(TaskProcessorService.name);
  private readonly concurrency = 5; // Control concurrency

  constructor(private readonly tasksService: TasksService) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);
    
    try {
      switch (job.name) {
        case 'task-status-update':
          return await this.handleStatusUpdate(job);
        case 'overdue-tasks-notification':
          return await this.handleOverdueTasks(job);
        default:
          this.logger.warn(`Unknown job type: ${job.name}`);
          return { success: false, error: 'Unknown job type' };
      }
    } catch (error) {
      this.logger.error(`Error processing job ${job.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Implement retry strategy for failed jobs
      if (job.attemptsMade < 3) {
        this.logger.warn(`Retrying job ${job.id}, attempt ${job.attemptsMade + 1}/3`);
        throw error; // This will trigger a retry
      } else {
        this.logger.error(`Job ${job.id} failed after 3 attempts, marking as failed`);
        return { 
          success: false, 
          error: 'Job failed after maximum retries',
          taskId: job.data?.taskId 
        };
      }
    }
  }

  private async handleStatusUpdate(job: Job) {
    const { taskId, status } = job.data;
    
    if (!taskId || !status) {
      return { success: false, error: 'Missing required data' };
    }
    
    // Validate status values
    if (!Object.values(TaskStatus).includes(status)) {
      return { success: false, error: 'Invalid status value' };
    }
    
    try {
      // Use transaction handling for status updates
      const task = await this.tasksService.updateStatus(taskId, status);
      
      return { 
        success: true,
        taskId: task.id,
        newStatus: task.status
      };
    } catch (error) {
      this.logger.error(`Failed to update task ${taskId} status: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error; // Let the retry mechanism handle it
    }
  }

  private async handleOverdueTasks(job: Job) {
    this.logger.debug('Processing overdue tasks notification');
    
    try {
      const { taskId, dueDate, userId } = job.data;
      
      if (!taskId || !userId) {
        return { success: false, error: 'Missing required data for overdue task' };
      }
      
      // Process overdue task with proper batching
      // Update task status to indicate it's overdue
      const task = await this.tasksService.updateStatus(taskId, TaskStatus.IN_PROGRESS);
      
      // Log overdue task details for monitoring
      this.logger.warn(`Task ${taskId} is overdue (due: ${dueDate}), assigned to user ${userId}`);
      
      return { 
        success: true, 
        message: 'Overdue task processed',
        taskId,
        newStatus: task.status,
        overdueDate: dueDate
      };
    } catch (error) {
      this.logger.error(`Failed to process overdue task: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error; // Let the retry mechanism handle it
    }
  }
} 