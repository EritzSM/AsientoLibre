import { Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../common/supabase-auth.guard.js';
import type { AuthenticatedRequest } from '../common/supabase-auth.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications') @UseGuards(SupabaseAuthGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  mine(@Req() req: AuthenticatedRequest) { return this.notifications.findMine(req.actorId); }

  @Patch(':id/read')
  read(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) { return this.notifications.markRead(req.actorId, id); }
}
