-- ==============================================================================
-- Asiento Libre — Migración: Notificaciones de cambio de ruta (SCRUM-135/137)
-- Sprint: HU-NotificacionCambios
-- ==============================================================================
-- Esta migración documenta y extiende los tipos de notificación para soportar:
--   - time_changed    : El horario de salida de una ruta fue modificado
--   - route_cancelled : Una ruta fue cancelada por el conductor
--   - booking_accepted: Una solicitud de reserva fue aceptada por el conductor
--   - new_booking     : El conductor recibió una nueva reserva confirmada
--
-- NOTA: El CHECK constraint se agrega con NOT VALID para no validar filas
-- históricas que puedan tener tipos distintos. Solo aplica a INSERT/UPDATE
-- nuevos. Ejecutar en Supabase SQL Editor.
-- ==============================================================================

-- 1. Índice compuesto para consultas por destinatario + tipo
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_type
  ON public.notifications(recipient_id, type, created_at DESC);

-- 2. Índice parcial para notificaciones no leídas (filtro frecuente)
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications(recipient_id, read_at)
  WHERE read_at IS NULL;

-- 3. CHECK constraint de tipos válidos.
--    NOT VALID = solo aplica a filas nuevas, no rompe datos históricos.
--    Si en el futuro quieres validar también las existentes, ejecuta:
--       ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      -- Recordatorios de viaje (Sprint 2 - HU09)
      'trip_reminder_24h',
      'trip_reminder_1h',
      -- Asistencia y cupos
      'attendance_confirmed',
      'attendance_missing',
      'seat_released',
      -- Reservas y solicitudes (Sprint 2 / Sprint 3)
      'booking_requested',
      'booking_confirmed',
      'booking_accepted',
      'new_booking',
      -- Cancelaciones
      'route_cancelled_passenger',
      'route_cancelled',
      -- Cambio de horario (SCRUM-135)
      'time_changed'
    )
  ) NOT VALID;

-- 4. Valor por defecto para el campo metadata (evita NULLs)
ALTER TABLE public.notifications
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

-- 5. Documentación inline de la tabla
COMMENT ON TABLE public.notifications IS
  'Notificaciones internas de Asiento Libre. '
  'Nuevos tipos SCRUM-135: time_changed, route_cancelled, booking_accepted, new_booking.';
