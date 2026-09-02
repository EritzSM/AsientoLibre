import { Module, Global } from '@nestjs/common';
import { SupabaseService } from './supabase.service.js';

@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}

