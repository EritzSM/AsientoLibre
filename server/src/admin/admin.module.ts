import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { SupabaseModule } from '../supabase/supabase.module.js';
import { AiModule } from '../ai/ai.module.js';

@Module({
  imports: [SupabaseModule, AiModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
