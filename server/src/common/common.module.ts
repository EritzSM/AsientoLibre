import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';

@Module({ imports: [SupabaseModule], providers: [SupabaseAuthGuard], exports: [SupabaseAuthGuard] })
export class CommonModule {}
