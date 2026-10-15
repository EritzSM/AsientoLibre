import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { VehiclesController } from './vehicles.controller.js';
import { VehiclesService } from './vehicles.service.js';
import { AiModule } from '../ai/ai.module.js';

@Module({
  imports: [CommonModule, AiModule],
  controllers: [VehiclesController],
  providers: [VehiclesService],
})
export class VehiclesModule {}
