import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { EmailModule } from '../email/email.module.js';
import { PushNotificationService } from '../reminders/push-notification.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { ChangeNotificationService } from './change-notification.service.js';

@Module({
  imports: [CommonModule, EmailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, ChangeNotificationService, PushNotificationService],
  exports: [ChangeNotificationService],
})
export class NotificationsModule {}
