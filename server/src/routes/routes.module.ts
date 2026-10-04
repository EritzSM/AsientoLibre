import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RoutesController } from './routes.controller.js';
import { RoutesService } from './routes.service.js';
import { RouteAlternativesService } from './route-alternatives.service.js';

@Module({
  imports: [CommonModule, NotificationsModule],
  controllers: [RoutesController],
  providers: [RoutesService, RouteAlternativesService],
})
export class RoutesModule {}
