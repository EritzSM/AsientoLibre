import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../common/supabase-auth.guard.js';
import type { AuthenticatedRequest } from '../common/supabase-auth.guard.js';
import { RemovePushTokenDto, SavePushTokenDto } from './dto/reminder.dto.js';
import { RemindersService } from './reminders.service.js';

@Controller('reminders')
@UseGuards(SupabaseAuthGuard)
export class RemindersController {
  constructor(@Inject(RemindersService) private readonly reminders: RemindersService) {}

  @Get()
  dashboard(@Req() req: AuthenticatedRequest) {
    return this.reminders.dashboard(req.actorId);
  }

  @Get('routes/:routeId/attendance')
  attendance(
    @Req() req: AuthenticatedRequest,
    @Param('routeId', new ParseUUIDPipe()) routeId: string,
  ) {
    return this.reminders.attendanceForRoute(req.actorId, routeId);
  }

  @Post('routes/:routeId/confirm')
  confirm(
    @Req() req: AuthenticatedRequest,
    @Param('routeId', new ParseUUIDPipe()) routeId: string,
  ) {
    return this.reminders.confirm(req.actorId, routeId);
  }

  @Post('routes/:routeId/attendance/:passengerId/release')
  release(
    @Req() req: AuthenticatedRequest,
    @Param('routeId', new ParseUUIDPipe()) routeId: string,
    @Param('passengerId', new ParseUUIDPipe()) passengerId: string,
  ) {
    return this.reminders.release(req.actorId, routeId, passengerId);
  }

  @Put('push-token')
  savePushToken(@Req() req: AuthenticatedRequest, @Body() dto: SavePushTokenDto) {
    return this.reminders.savePushToken(req.actorId, dto.token, dto.platform);
  }

  @Delete('push-token')
  removePushToken(@Req() req: AuthenticatedRequest, @Body() dto: RemovePushTokenDto) {
    return this.reminders.removePushToken(req.actorId, dto.token);
  }
}
