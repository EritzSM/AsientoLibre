/**
 * SCRUM-135: Tipos de eventos de ruta que disparan notificaciones de cambio.
 * Estos eventos son emitidos por RoutesService y consumidos por ChangeNotificationService.
 */

export interface RouteTimeChangedEvent {
  type: 'route.time_changed';
  routeId: string;
  origin: string;
  destination: string;
  oldDepartureAt: string;
  newDepartureAt: string;
  passengerIds: string[];
}

export interface RouteCancelledEvent {
  type: 'route.cancelled';
  routeId: string;
  origin: string;
  destination: string;
  departureAt: string;
  passengerIds: string[];
}

export interface BookingAcceptedEvent {
  type: 'booking.accepted';
  bookingId: string;
  routeId: string;
  origin: string;
  destination: string;
  departureAt: string;
  passengerId: string;
  driverId: string;
}

export type RouteEvent = RouteTimeChangedEvent | RouteCancelledEvent | BookingAcceptedEvent;
