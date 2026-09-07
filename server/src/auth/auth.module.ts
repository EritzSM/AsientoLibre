import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SupabaseModule } from '../supabase/supabase.module.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [SupabaseModule, EmailModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
