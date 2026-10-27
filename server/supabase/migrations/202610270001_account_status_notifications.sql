-- Notificaciones enviadas cuando la administración bloquea o desbloquea una cuenta.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      'trip_reminder_24h',
      'trip_reminder_1h',
      'attendance_confirmed',
      'attendance_missing',
      'seat_released',
      'booking_requested',
      'booking_confirmed',
      'booking_accepted',
      'booking_rejected',
      'booking_cancelled',
      'new_booking',
      'route_cancelled_passenger',
      'route_cancelled',
      'time_changed',
      'document_aprobado',
      'document_rechazado',
      'document_revision_manual',
      'document_pendiente',
      'favorite_route_available',
      'account_blocked',
      'account_unblocked'
    )
  ) NOT VALID;
