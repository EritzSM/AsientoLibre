-- HU-04: solicitudes de cupo, aceptación y confirmación transaccional.
BEGIN;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS responded_at timestamptz;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'cancelled'));
CREATE INDEX IF NOT EXISTS bookings_route_pending_idx
  ON public.bookings(route_id, created_at) WHERE status = 'pending';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'route_cancelled', 'trip_reminder_24h', 'trip_reminder_1h',
  'attendance_confirmed', 'attendance_missing', 'seat_released',
  'booking_requested', 'booking_confirmed'
));

-- A conductor can receive one notification per requesting passenger. Older
-- notifications without a subject remain unique by route, recipient and type.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_route_recipient_type_unique;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_route_recipient_type_subject_unique
  ON public.notifications(
    route_id, recipient_id, type,
    COALESCE(metadata->>'subjectUserId', '')
  );

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
  IF v_route.status <> 'published' OR v_route.departure_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Esta ruta ya no admite solicitudes."}';
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
  -- Every booking mutation locks the route first, matching cancellation and request creation.
  SELECT * INTO v_route FROM public.routes WHERE id = v_route_id FOR UPDATE;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking FOR UPDATE;
  IF v_route.driver_id IS DISTINCT FROM p_actor
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'conductor') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el conductor de la ruta puede aceptar esta solicitud."}';
  END IF;
  IF v_route.status <> 'published' OR v_route.departure_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"La ruta ya no admite reservas."}';
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

-- Keeps pending requests from remaining active after a route is withdrawn.
CREATE OR REPLACE FUNCTION public.close_pending_bookings_on_route_withdrawal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'published' AND NEW.status IN ('deleted', 'cancelled') THEN
    UPDATE public.bookings SET status = 'cancelled', responded_at = now(), updated_at = now()
    WHERE route_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS close_pending_bookings_on_route_withdrawal_trigger ON public.routes;
CREATE TRIGGER close_pending_bookings_on_route_withdrawal_trigger
  AFTER UPDATE OF status ON public.routes FOR EACH ROW
  EXECUTE FUNCTION public.close_pending_bookings_on_route_withdrawal();

-- Compatible replacement for Sprint 1 and the cancellation-before-departure migration.
CREATE OR REPLACE FUNCTION public.remove_route(p_actor uuid, p_route uuid, p_confirm_cancel boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_route public.routes; v_confirmed integer; v_notified integer; v_status text;
BEGIN
  SELECT * INTO v_route FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;
  IF v_route.driver_id IS DISTINCT FROM p_actor
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'conductor') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el conductor propietario puede retirar esta ruta."}';
  END IF;
  IF v_route.status <> 'published' THEN
    SELECT count(*)::integer INTO v_notified FROM public.notifications
    WHERE route_id = p_route AND type = 'route_cancelled';
    RETURN jsonb_build_object('message', 'La ruta ya fue retirada.', 'status', v_route.status,
      'notifiedPassengers', v_notified);
  END IF;
  IF v_route.departure_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"La ruta ya comenzó y no puede cancelarse."}';
  END IF;
  SELECT count(*)::integer INTO v_confirmed FROM public.bookings
  WHERE route_id = p_route AND status = 'confirmed';
  IF v_confirmed > 0 AND p_confirm_cancel IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING MESSAGE = jsonb_build_object(
      'code', 'CANCELLATION_CONFIRMATION_REQUIRED',
      'message', 'Esta ruta tiene pasajeros confirmados. Confirma la cancelación para notificarlos.',
      'confirmedPassengers', v_confirmed
    )::text;
  END IF;
  v_status := CASE WHEN v_confirmed > 0 THEN 'cancelled' ELSE 'deleted' END;
  UPDATE public.routes SET status = v_status, updated_at = now() WHERE id = p_route;
  IF v_status = 'cancelled' THEN
    INSERT INTO public.notifications(route_id, recipient_id, type, title, message, metadata)
    SELECT p_route, passenger_id, 'route_cancelled', 'Tu viaje fue cancelado',
      format('El conductor canceló la ruta de %s a %s del %s a las %s (hora de Colombia). Tu reserva fue cancelada.',
        v_route.origin, v_route.destination,
        to_char(v_route.departure_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'),
        to_char(v_route.departure_at AT TIME ZONE 'America/Bogota', 'HH24:MI')),
      jsonb_build_object('action', 'route_cancelled')
    FROM public.bookings WHERE route_id = p_route AND status = 'confirmed'
    ON CONFLICT DO NOTHING;
    UPDATE public.bookings SET status = 'cancelled', responded_at = now(), updated_at = now()
    WHERE route_id = p_route AND status = 'confirmed';
  END IF;
  SELECT count(*)::integer INTO v_notified FROM public.notifications
  WHERE route_id = p_route AND type = 'route_cancelled';
  RETURN jsonb_build_object(
    'message', CASE WHEN v_status = 'cancelled' THEN 'Ruta cancelada y pasajeros notificados.' ELSE 'Ruta eliminada.' END,
    'status', v_status, 'notifiedPassengers', v_notified
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_booking(uuid,uuid,integer),
  public.accept_booking_request(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_booking(uuid,uuid,integer),
  public.accept_booking_request(uuid,uuid) TO service_role;

COMMIT;
