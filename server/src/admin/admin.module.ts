import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { SupabaseModule } from '../supabase/supabase.module.js';

@Module({
  imports: [SupabaseModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
