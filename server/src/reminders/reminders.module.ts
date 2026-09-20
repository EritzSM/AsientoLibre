import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { EmailModule } from '../email/email.module.js';
import { ReminderDispatcherService } from './reminder-dispatcher.service.js';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';
import { PushNotificationService } from './push-notification.service.js';

@Module({
  imports: [CommonModule, EmailModule],
  controllers: [RemindersController],
  providers: [RemindersService, ReminderSchedulerService, ReminderDispatcherService, PushNotificationService],
  exports: [ReminderSchedulerService],
})
export class RemindersModule {}
