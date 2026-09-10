import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({ imports: [CommonModule], controllers: [NotificationsController], providers: [NotificationsService] })
export class NotificationsModule {}
