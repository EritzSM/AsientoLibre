import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SupabaseModule } from './supabase/supabase.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RoutesModule } from './routes/routes.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { HealthController } from './health.controller.js';
import { ScheduleModule } from '@nestjs/schedule';
import { RemindersModule } from './reminders/reminders.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    ScheduleModule.forRoot(),
    SupabaseModule,
    AuthModule,
    RoutesModule,
    VehiclesModule,
    NotificationsModule,
    RemindersModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
