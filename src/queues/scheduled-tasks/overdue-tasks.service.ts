import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Task } from '../../modules/tasks/entities/task.entity';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

@Injectable()
export class OverdueTasksService {
  private readonly logger = new Logger(OverdueTasksService.name);

  constructor(
    @InjectQueue('task-processing')
    private taskQueue: Queue,
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks() {
    this.logger.debug('Checking for overdue tasks...');
    
    try {
      // 1. Find all tasks that are overdue (due date is in the past)
      const now = new Date();
      const overdueTasks = await this.tasksRepository.find({
        where: {
          dueDate: LessThan(now),
          status: TaskStatus.PENDING,
        },
      });
      
      this.logger.log(`Found ${overdueTasks.length} overdue tasks`);
      
      // 2. Add them to the task processing queue
      for (const task of overdueTasks) {
        try {
          await this.taskQueue.add('overdue-tasks-notification', {
            taskId: task.id,
            dueDate: task.dueDate,
            userId: task.userId,
          });
          this.logger.debug(`Added overdue task ${task.id} to queue`);
        } catch (error) {
          this.logger.error(`Failed to add overdue task ${task.id} to queue: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      this.logger.debug('Overdue tasks check completed');
    } catch (error) {
      this.logger.error(`Error checking overdue tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
} 