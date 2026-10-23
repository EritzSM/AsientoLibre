-- Migration: 202610220001_document_notifications.sql
-- Permite guardar notificaciones que no están vinculadas a una ruta (ej. revisión de documentos del conductor)
-- y agrega los tipos de notificación para documentos.

-- 1. Permitir route_id NULL en la tabla notifications
ALTER TABLE public.notifications
  ALTER COLUMN route_id DROP NOT NULL;

-- 2. Actualizar el CHECK constraint de tipos de notificación
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
      'time_changed',
      -- Notificaciones de documentos de conductor (IA / Admin)
      'document_aprobado',
      'document_rechazado',
      'document_revision_manual',
      'document_pendiente'
    )
  ) NOT VALID;
