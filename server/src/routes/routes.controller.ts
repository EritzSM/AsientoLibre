import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { SupabaseAuthGuard } from '../common/supabase-auth.guard.js';
import type { AuthenticatedRequest } from '../common/supabase-auth.guard.js';
import { RoutesService } from './routes.service.js';
import { CancelRouteDto, CreateBookingDto, CreateRouteDto, FindRoutesDto } from './dto/route.dto.js';

const dtoPipe = (expectedType: new () => object) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true });

@Controller('routes')
export class RoutesController {
  constructor(@Inject(RoutesService) private readonly routes: RoutesService) {}

  @Get()
  available(@Query(dtoPipe(FindRoutesDto)) query: FindRoutesDto) { return this.routes.findAvailable(query); }

  @Get('mine') @UseGuards(SupabaseAuthGuard)
  mine(@Req() req: AuthenticatedRequest) { return this.routes.findMine(req.actorId); }

  @Get('bookings/mine') @UseGuards(SupabaseAuthGuard)
  myBookings(@Req() req: AuthenticatedRequest) { return this.routes.myBookings(req.actorId); }

  @Post() @UseGuards(SupabaseAuthGuard)
  create(@Req() req: AuthenticatedRequest, @Body(dtoPipe(CreateRouteDto)) body: CreateRouteDto) { return this.routes.create(req.actorId, body); }

  @Delete(':id') @UseGuards(SupabaseAuthGuard)
  remove(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) { return this.routes.remove(req.actorId, id); }

  @Post(':id/cancel') @HttpCode(200) @UseGuards(SupabaseAuthGuard)
  cancel(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body(dtoPipe(CancelRouteDto)) _body: CancelRouteDto) {
    return this.routes.cancel(req.actorId, id);
  }

  @Post(':id/bookings') @UseGuards(SupabaseAuthGuard)
  book(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body(dtoPipe(CreateBookingDto)) body: CreateBookingDto) {
    return this.routes.book(req.actorId, id, body.seats);
  }
}
