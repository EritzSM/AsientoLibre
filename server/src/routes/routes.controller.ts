import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { SupabaseAuthGuard } from '../common/supabase-auth.guard.js';
import type { AuthenticatedRequest } from '../common/supabase-auth.guard.js';
import { RoutesService } from './routes.service.js';
import { RouteAlternativesService } from './route-alternatives.service.js';
import { CalendarQueryDto, CancelRouteDto, CreateBookingDto, CreateRecurringRouteDto, CreateRouteDto, FindRoutesDto, RateRouteDto, UpdateRecurringRouteDto } from './dto/route.dto.js';

const dtoPipe = (expectedType: new () => object) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true });

@Controller('routes')
export class RoutesController {
  constructor(
    @Inject(RoutesService) private readonly routes: RoutesService,
    @Inject(RouteAlternativesService) private readonly alternatives: RouteAlternativesService,
  ) {}

  @Get()
  available(@Query(dtoPipe(FindRoutesDto)) query: FindRoutesDto) { return this.routes.findAvailable(query); }

  @Get('promotions')
  activePromotions() { return this.routes.activePromotions(); }

  @Get('mine') @UseGuards(SupabaseAuthGuard)
  mine(@Req() req: AuthenticatedRequest) { return this.routes.findMine(req.actorId); }

  @Get('bookings/mine') @UseGuards(SupabaseAuthGuard)
  myBookings(@Req() req: AuthenticatedRequest) { return this.routes.myBookings(req.actorId); }

  @Get('payments/mine') @UseGuards(SupabaseAuthGuard)
  myPayments(@Req() req: AuthenticatedRequest) { return this.routes.myPayments(req.actorId); }

  @Get('payments/pending') @UseGuards(SupabaseAuthGuard)
  pendingPayments(@Req() req: AuthenticatedRequest) { return this.routes.payments(req.actorId); }

  @Get('payments/owned') @UseGuards(SupabaseAuthGuard)
  ownedPayments(@Req() req: AuthenticatedRequest) { return this.routes.ownedPayments(req.actorId); }

  @Post('payments/:paymentId/confirm') @HttpCode(200) @UseGuards(SupabaseAuthGuard)
  confirmPayment(@Req() req: AuthenticatedRequest, @Param('paymentId', new ParseUUIDPipe()) paymentId: string) {
    return this.routes.confirmPayment(req.actorId, paymentId);
  }

  @Get('booking-requests/mine') @UseGuards(SupabaseAuthGuard)
  bookingRequests(@Req() req: AuthenticatedRequest) { return this.routes.pendingBookingRequests(req.actorId); }

  @Get('ratings/mine') @UseGuards(SupabaseAuthGuard)
  ratingSummary(@Req() req: AuthenticatedRequest) { return this.routes.ratingSummary(req.actorId); }

  @Get('favorites') @UseGuards(SupabaseAuthGuard)
  favorites(@Req() req: AuthenticatedRequest) { return this.routes.favorites(req.actorId); }

  @Post('favorites/:routeId') @HttpCode(200) @UseGuards(SupabaseAuthGuard)
  saveFavorite(@Req() req: AuthenticatedRequest, @Param('routeId', new ParseUUIDPipe()) routeId: string) {
    return this.routes.saveFavorite(req.actorId, routeId);
  }

  @Delete('favorites/:favoriteId') @UseGuards(SupabaseAuthGuard)
  removeFavorite(@Req() req: AuthenticatedRequest, @Param('favoriteId', new ParseUUIDPipe()) favoriteId: string) {
    return this.routes.removeFavorite(req.actorId, favoriteId);
  }

  @Post('recurring') @UseGuards(SupabaseAuthGuard)
  createRecurring(@Req() req: AuthenticatedRequest, @Body(dtoPipe(CreateRecurringRouteDto)) body: CreateRecurringRouteDto) { return this.routes.createRecurring(req.actorId, body); }

  @Patch('recurring/:seriesId') @UseGuards(SupabaseAuthGuard)
  updateRecurring(@Req() req: AuthenticatedRequest, @Param('seriesId', new ParseUUIDPipe()) seriesId: string, @Body(dtoPipe(UpdateRecurringRouteDto)) body: UpdateRecurringRouteDto) {
    return this.routes.updateRecurring(req.actorId, seriesId, body.time);
  }

  @Get('calendar') @UseGuards(SupabaseAuthGuard)
  calendar(@Req() req: AuthenticatedRequest, @Query(dtoPipe(CalendarQueryDto)) query: CalendarQueryDto) { return this.routes.calendar(req.actorId, query.from, query.to); }

  @Post('booking-requests/:bookingId/accept') @HttpCode(200) @UseGuards(SupabaseAuthGuard)
  acceptBookingRequest(
    @Req() req: AuthenticatedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ) {
    return this.routes.acceptBookingRequest(req.actorId, bookingId);
  }

  @Post('booking-requests/:bookingId/reject') @HttpCode(200) @UseGuards(SupabaseAuthGuard)
  rejectBookingRequest(
    @Req() req: AuthenticatedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ) {
    return this.routes.rejectBookingRequest(req.actorId, bookingId);
  }

  @Post('bookings/:bookingId/cancel') @HttpCode(200) @UseGuards(SupabaseAuthGuard)
  cancelBooking(
    @Req() req: AuthenticatedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ) {
    return this.routes.cancelBooking(req.actorId, bookingId);
  }

  @Post() @UseGuards(SupabaseAuthGuard)
  create(@Req() req: AuthenticatedRequest, @Body(dtoPipe(CreateRouteDto)) body: CreateRouteDto) { return this.routes.create(req.actorId, body); }

  @Delete(':id') @UseGuards(SupabaseAuthGuard)
  remove(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) { return this.routes.remove(req.actorId, id); }

  @Post(':id/cancel') @HttpCode(200) @UseGuards(SupabaseAuthGuard)
  cancel(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body(dtoPipe(CancelRouteDto)) _body: CancelRouteDto) {
    return this.routes.cancel(req.actorId, id);
  }

  @Post(':id/finish') @HttpCode(200) @UseGuards(SupabaseAuthGuard)
  finish(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.routes.finish(req.actorId, id);
  }

  @Get(':id/ratings/pending') @UseGuards(SupabaseAuthGuard)
  pendingRatingTargets(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.routes.pendingRatingTargets(req.actorId, id);
  }

  @Post(':id/ratings') @HttpCode(200) @UseGuards(SupabaseAuthGuard)
  rate(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body(dtoPipe(RateRouteDto)) body: RateRouteDto) {
    return this.routes.rate(req.actorId, id, body.ratedId, body.score, body.comment);
  }

  @Post(':id/bookings') @UseGuards(SupabaseAuthGuard)
  book(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body(dtoPipe(CreateBookingDto)) body: CreateBookingDto) {
    return this.routes.requestBookingWithPromotion(req.actorId, id, body.seats, body.promotionId ?? null);
  }

  /** SCRUM-136: Rutas alternativas sugeridas al pasajero cuando se cancela su viaje */
  @Get(':id/alternatives')
  getAlternatives(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.alternatives.findAlternatives(id);
  }
}
