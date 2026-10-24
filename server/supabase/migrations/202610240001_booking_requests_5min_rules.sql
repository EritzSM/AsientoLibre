-- Migration: 202610240001_booking_requests_5min_rules.sql
-- Regla de 5 minutos para solicitudes, cancelaciones, aceptación y rechazo de cupos
BEGIN;

-- 1. Actualizar el CHECK constraint de tipos de notificación para incluir booking_rejected y booking_cancelled
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
      'document_pendiente'
    )
  ) NOT VALID;

-- 2. Actualizar request_booking para exigir al menos 5 minutos antes de la salida
CREATE OR REPLACE FUNCTION public.request_booking(
  p_actor uuid, p_route uuid, p_seats integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_route public.routes;
  v_booking public.bookings;
  v_reserved integer;
  v_passenger_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'pasajero') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo un pasajero puede solicitar cupos."}';
  END IF;
  SELECT * INTO v_route FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;
  IF v_route.driver_id = p_actor THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"No puedes solicitar cupo en tu propia ruta."}';
  END IF;
  IF v_route.status <> 'published' OR v_route.departure_at <= (now() + interval '5 minutes') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Esta ruta ya no admite solicitudes (faltan menos de 5 minutos para la salida)."}';
  END IF;
  IF p_seats IS NULL OR p_seats NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Solicita una cantidad entera de cupos entre 1 y 8."}';
  END IF;
  SELECT COALESCE(sum(seats), 0)::integer INTO v_reserved
  FROM public.bookings WHERE route_id = p_route AND status = 'confirmed';
  IF p_seats > v_route.seats - v_reserved THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"No hay suficientes cupos disponibles."}';
  END IF;

  SELECT * INTO v_booking FROM public.bookings
  WHERE route_id = p_route AND passenger_id = p_actor FOR UPDATE;
  IF FOUND AND v_booking.status = 'confirmed' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Ya tienes una reserva confirmada para esta ruta."}';
  END IF;
  IF FOUND AND v_booking.status = 'pending' AND v_booking.seats = p_seats THEN
    RETURN jsonb_build_object('id', v_booking.id, 'routeId', p_route, 'seats', v_booking.seats,
      'status', v_booking.status, 'createdAt', v_booking.created_at);
  ELSIF FOUND THEN
    UPDATE public.bookings SET seats = p_seats, status = 'pending', responded_at = NULL, updated_at = now()
    WHERE id = v_booking.id RETURNING * INTO v_booking;
  ELSE
    INSERT INTO public.bookings(route_id, passenger_id, seats, status)
    VALUES (p_route, p_actor, p_seats, 'pending') RETURNING * INTO v_booking;
  END IF;

  SELECT concat_ws(' ', first_name, last_name) INTO v_passenger_name
  FROM public.profiles WHERE id = p_actor;
  UPDATE public.notifications SET
    title = 'Nueva solicitud de cupo',
    message = format('%s solicitó %s cupo(s) para la ruta de %s a %s.',
      v_passenger_name, p_seats, v_route.origin, v_route.destination),
    metadata = jsonb_build_object('subjectUserId', p_actor, 'bookingId', v_booking.id, 'action', 'review_booking'),
    read_at = NULL,
    created_at = now()
  WHERE route_id = p_route AND recipient_id = v_route.driver_id AND type = 'booking_requested'
    AND metadata->>'subjectUserId' = p_actor::text;
  IF NOT FOUND THEN
    INSERT INTO public.notifications(route_id, recipient_id, type, title, message, metadata)
    VALUES (p_route, v_route.driver_id, 'booking_requested', 'Nueva solicitud de cupo',
      format('%s solicitó %s cupo(s) para la ruta de %s a %s.',
        v_passenger_name, p_seats, v_route.origin, v_route.destination),
      jsonb_build_object('subjectUserId', p_actor, 'bookingId', v_booking.id, 'action', 'review_booking'));
  END IF;
  RETURN jsonb_build_object('id', v_booking.id, 'routeId', p_route, 'seats', v_booking.seats,
    'status', v_booking.status, 'createdAt', v_booking.created_at);
END;
$$;

-- 3. Actualizar accept_booking_request para exigir al menos 5 minutos antes de la salida
CREATE OR REPLACE FUNCTION public.accept_booking_request(
  p_actor uuid, p_booking uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_route public.routes;
  v_booking public.bookings;
  v_route_id uuid;
  v_reserved integer;
  v_passenger_name text;
BEGIN
  SELECT route_id INTO v_route_id FROM public.bookings WHERE id = p_booking;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La solicitud no existe."}';
  END IF;
  SELECT * INTO v_route FROM public.routes WHERE id = v_route_id FOR UPDATE;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking FOR UPDATE;
  IF v_route.driver_id IS DISTINCT FROM p_actor
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'conductor') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el conductor de la ruta puede aceptar esta solicitud."}';
  END IF;
  IF v_route.status <> 'published' OR v_route.departure_at <= (now() + interval '5 minutes') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"No se pueden aceptar solicitudes si faltan menos de 5 minutos para la salida del viaje."}';
  END IF;
  IF v_booking.status = 'confirmed' THEN
    RETURN jsonb_build_object('id', v_booking.id, 'routeId', v_booking.route_id,
      'passengerId', v_booking.passenger_id, 'seats', v_booking.seats, 'status', v_booking.status,
      'availableSeats', v_route.seats - (SELECT COALESCE(sum(seats), 0)::integer FROM public.bookings
        WHERE route_id = v_route.id AND status = 'confirmed'));
  END IF;
  IF v_booking.status <> 'pending' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"La solicitud ya fue cerrada."}';
  END IF;
  SELECT COALESCE(sum(seats), 0)::integer INTO v_reserved
  FROM public.bookings WHERE route_id = v_route.id AND status = 'confirmed';
  IF v_booking.seats > v_route.seats - v_reserved THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Los cupos disponibles cambiaron y ya no alcanzan para esta solicitud."}';
  END IF;

  UPDATE public.bookings SET status = 'confirmed', responded_at = now(), updated_at = now()
  WHERE id = v_booking.id RETURNING * INTO v_booking;
  SELECT concat_ws(' ', first_name, last_name) INTO v_passenger_name
  FROM public.profiles WHERE id = v_booking.passenger_id;

  INSERT INTO public.notifications(route_id, recipient_id, type, title, message, metadata) VALUES
    (v_route.id, v_booking.passenger_id, 'booking_confirmed', 'Reserva confirmada',
      format('El conductor aceptó tu solicitud de %s cupo(s) para la ruta de %s a %s.',
        v_booking.seats, v_route.origin, v_route.destination),
      jsonb_build_object('subjectUserId', p_actor, 'bookingId', v_booking.id, 'action', 'booking_confirmed')),
    (v_route.id, p_actor, 'booking_confirmed', 'Reserva confirmada',
      format('Confirmaste %s cupo(s) para %s en la ruta de %s a %s.',
        v_booking.seats, v_passenger_name, v_route.origin, v_route.destination),
      jsonb_build_object('subjectUserId', v_booking.passenger_id, 'bookingId', v_booking.id, 'action', 'booking_confirmed'))
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('id', v_booking.id, 'routeId', v_booking.route_id,
    'passengerId', v_booking.passenger_id, 'seats', v_booking.seats, 'status', v_booking.status,
    'availableSeats', v_route.seats - v_reserved - v_booking.seats, 'confirmedAt', v_booking.responded_at);
END;
$$;

-- 4. Nueva función reject_booking_request para que el conductor rechace una solicitud
CREATE OR REPLACE FUNCTION public.reject_booking_request(
  p_actor uuid, p_booking uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_route public.routes;
  v_booking public.bookings;
  v_route_id uuid;
  v_passenger_name text;
BEGIN
  SELECT route_id INTO v_route_id FROM public.bookings WHERE id = p_booking;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La solicitud no existe."}';
  END IF;
  SELECT * INTO v_route FROM public.routes WHERE id = v_route_id FOR UPDATE;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking FOR UPDATE;
  IF v_route.driver_id IS DISTINCT FROM p_actor
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'conductor') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el conductor de la ruta puede rechazar esta solicitud."}';
  END IF;
  IF v_route.departure_at <= (now() + interval '5 minutes') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"No se pueden rechazar solicitudes si faltan menos de 5 minutos para la salida del viaje."}';
  END IF;
  IF v_booking.status <> 'pending' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"La solicitud ya no está pendiente."}';
  END IF;

  UPDATE public.bookings SET status = 'cancelled', responded_at = now(), updated_at = now()
  WHERE id = v_booking.id RETURNING * INTO v_booking;

  INSERT INTO public.notifications(route_id, recipient_id, type, title, message, metadata) VALUES
    (v_route.id, v_booking.passenger_id, 'booking_rejected', 'Solicitud rechazada',
      format('El conductor rechazó tu solicitud de %s cupo(s) para la ruta de %s a %s.',
        v_booking.seats, v_route.origin, v_route.destination),
      jsonb_build_object('subjectUserId', p_actor, 'bookingId', v_booking.id, 'action', 'booking_rejected'))
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('id', v_booking.id, 'routeId', v_booking.route_id,
    'passengerId', v_booking.passenger_id, 'seats', v_booking.seats, 'status', v_booking.status);
END;
$$;

-- 5. Nueva función cancel_booking_by_passenger para que el pasajero cancele su solicitud o reserva
CREATE OR REPLACE FUNCTION public.cancel_booking_by_passenger(
  p_actor uuid, p_booking uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_route public.routes;
  v_booking public.bookings;
  v_passenger_name text;
  v_was_confirmed boolean;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La reserva o solicitud no existe."}';
  END IF;
  IF v_booking.passenger_id IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el pasajero que solicitó el cupo puede cancelar esta reserva."}';
  END IF;
  IF v_booking.status = 'cancelled' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Esta solicitud o reserva ya está cancelada."}';
  END IF;

  SELECT * INTO v_route FROM public.routes WHERE id = v_booking.route_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;

  IF v_route.departure_at <= (now() + interval '5 minutes') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"No se puede cancelar una solicitud o reserva si faltan menos de 5 minutos para la salida del viaje."}';
  END IF;

  v_was_confirmed := (v_booking.status = 'confirmed');

  UPDATE public.bookings SET status = 'cancelled', responded_at = now(), updated_at = now()
  WHERE id = v_booking.id RETURNING * INTO v_booking;

  SELECT concat_ws(' ', first_name, last_name) INTO v_passenger_name
  FROM public.profiles WHERE id = p_actor;

  -- Notificar al conductor
  INSERT INTO public.notifications(route_id, recipient_id, type, title, message, metadata) VALUES
    (v_route.id, v_route.driver_id, 'booking_cancelled',
      CASE WHEN v_was_confirmed THEN 'Reserva cancelada por pasajero' ELSE 'Solicitud cancelada por pasajero' END,
      format('%s canceló su %s de %s cupo(s) para la ruta de %s a %s.',
        v_passenger_name,
        CASE WHEN v_was_confirmed THEN 'reserva' ELSE 'solicitud' END,
        v_booking.seats, v_route.origin, v_route.destination),
      jsonb_build_object('subjectUserId', p_actor, 'bookingId', v_booking.id, 'action', 'booking_cancelled_by_passenger'))
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('id', v_booking.id, 'routeId', v_booking.route_id,
    'passengerId', v_booking.passenger_id, 'seats', v_booking.seats, 'status', v_booking.status,
    'wasConfirmed', v_was_confirmed);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_booking_request(uuid,uuid),
  public.cancel_booking_by_passenger(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_booking_request(uuid,uuid),
  public.cancel_booking_by_passenger(uuid,uuid) TO service_role;

COMMIT;
