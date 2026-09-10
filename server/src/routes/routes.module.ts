import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { RoutesController } from './routes.controller.js';
import { RoutesService } from './routes.service.js';

@Module({ imports: [CommonModule], controllers: [RoutesController], providers: [RoutesService] })
export class RoutesModule {}
