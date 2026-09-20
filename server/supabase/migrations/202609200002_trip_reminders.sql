-- HU-09: recordatorios, asistencia y liberación sugerida de cupos.
BEGIN;

ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS meeting_point text;
UPDATE public.routes SET meeting_point = origin WHERE meeting_point IS NULL;
ALTER TABLE public.routes ALTER COLUMN meeting_point SET NOT NULL;
ALTER TABLE public.routes DROP CONSTRAINT IF EXISTS routes_meeting_point_length_check;
ALTER TABLE public.routes ADD CONSTRAINT routes_meeting_point_length_check
  CHECK (char_length(btrim(meeting_point)) BETWEEN 2 AND 200);

CREATE OR REPLACE FUNCTION public.ensure_route_meeting_point() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.meeting_point := btrim(COALESCE(NULLIF(NEW.meeting_point, ''), NEW.origin));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ensure_route_meeting_point_trigger ON public.routes;
CREATE TRIGGER ensure_route_meeting_point_trigger
  BEFORE INSERT OR UPDATE OF origin, meeting_point ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.ensure_route_meeting_point();

-- Append meeting_point without removing the completion column introduced by Sprint 2.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routes' AND column_name = 'driver_finished_at'
  ) THEN
    EXECUTE $view$CREATE OR REPLACE VIEW public.route_catalog WITH (security_invoker = true) AS
      SELECT r.id, r.driver_id, r.vehicle_id, r.origin, r.destination, r.departure_at,
        r.seats, r.price, r.note, r.status, r.created_at, r.updated_at,
        concat_ws(' ', p.first_name, p.last_name) AS driver_name,
        r.seats - COALESCE(b.reserved_seats, 0)::integer AS available_seats,
        COALESCE(b.confirmed_passengers, 0)::integer AS confirmed_passengers,
        r.driver_finished_at, r.meeting_point
      FROM public.routes r JOIN public.profiles p ON p.id = r.driver_id
      LEFT JOIN LATERAL (
        SELECT sum(seats) AS reserved_seats, count(*) AS confirmed_passengers
        FROM public.bookings WHERE route_id = r.id AND status = 'confirmed'
      ) b ON true$view$;
  ELSE
    EXECUTE $view$CREATE OR REPLACE VIEW public.route_catalog WITH (security_invoker = true) AS
      SELECT r.id, r.driver_id, r.vehicle_id, r.origin, r.destination, r.departure_at,
        r.seats, r.price, r.note, r.status, r.created_at, r.updated_at,
        concat_ws(' ', p.first_name, p.last_name) AS driver_name,
        r.seats - COALESCE(b.reserved_seats, 0)::integer AS available_seats,
        COALESCE(b.confirmed_passengers, 0)::integer AS confirmed_passengers,
        r.meeting_point
      FROM public.routes r JOIN public.profiles p ON p.id = r.driver_id
      LEFT JOIN LATERAL (
        SELECT sum(seats) AS reserved_seats, count(*) AS confirmed_passengers
        FROM public.bookings WHERE route_id = r.id AND status = 'confirmed'
      ) b ON true$view$;
  END IF;
END $migration$;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'route_cancelled', 'trip_reminder_24h', 'trip_reminder_1h',
  'attendance_confirmed', 'attendance_missing', 'seat_released',
  'booking_requested', 'booking_confirmed'
));
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_route_recipient_type_unique'
      AND conrelid = 'public.notifications'::regclass
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'notifications_route_recipient_type_subject_unique'
      AND relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_route_recipient_type_unique
      UNIQUE (route_id, recipient_id, type);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 20 AND 4096),
  platform text NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'android', 'ios')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON public.push_tokens(user_id);

CREATE TABLE IF NOT EXISTS public.trip_attendance (
  route_id uuid NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('driver', 'passenger')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'release_suggested', 'released', 'cancelled'
  )),
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (route_id, user_id)
);
CREATE INDEX IF NOT EXISTS trip_attendance_user_idx ON public.trip_attendance(user_id, status);

CREATE TABLE IF NOT EXISTS public.trip_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('24h', '1h', '30m_missing')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  worker_id text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trip_reminder_delivery_unique
  ON public.trip_reminder_deliveries (
    route_id, recipient_id, kind,
    COALESCE(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS trip_reminder_claim_idx
  ON public.trip_reminder_deliveries(status, available_at, created_at);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_tokens, public.trip_attendance, public.trip_reminder_deliveries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens, public.trip_attendance,
  public.trip_reminder_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.sync_route_driver_attendance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.trip_attendance(route_id, user_id, role)
  VALUES (NEW.id, NEW.driver_id, 'driver') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_route_driver_attendance_trigger ON public.routes;
CREATE TRIGGER sync_route_driver_attendance_trigger
  AFTER INSERT ON public.routes FOR EACH ROW EXECUTE FUNCTION public.sync_route_driver_attendance();

CREATE OR REPLACE FUNCTION public.sync_booking_attendance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    INSERT INTO public.trip_attendance(route_id, user_id, role, status)
    VALUES (NEW.route_id, NEW.passenger_id, 'passenger', 'pending')
    ON CONFLICT (route_id, user_id) DO UPDATE SET
      status = CASE WHEN public.trip_attendance.status = 'confirmed' THEN 'confirmed' ELSE 'pending' END,
      updated_at = now();
  ELSE
    UPDATE public.trip_attendance SET status = 'cancelled', updated_at = now()
    WHERE route_id = NEW.route_id AND user_id = NEW.passenger_id AND status <> 'released';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_booking_attendance_trigger ON public.bookings;
CREATE TRIGGER sync_booking_attendance_trigger
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.sync_booking_attendance();

INSERT INTO public.trip_attendance(route_id, user_id, role)
SELECT id, driver_id, 'driver' FROM public.routes
ON CONFLICT DO NOTHING;
INSERT INTO public.trip_attendance(route_id, user_id, role, status)
SELECT route_id, passenger_id, 'passenger', CASE WHEN status = 'confirmed' THEN 'pending' ELSE 'cancelled' END
FROM public.bookings
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_route_v2(
  p_actor uuid, p_origin text, p_destination text, p_departure_at timestamptz,
  p_seats integer, p_price numeric DEFAULT 0, p_note text DEFAULT NULL,
  p_meeting_point text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text; v_vehicle public.vehicles; v_route uuid;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_actor FOR UPDATE;
  IF v_role IS DISTINCT FROM 'conductor' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo un conductor puede publicar rutas."}';
  END IF;
  SELECT * INTO v_vehicle FROM public.vehicles WHERE user_id = p_actor FOR UPDATE;
  IF NOT FOUND OR v_vehicle.capacity IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Registra tu vehículo y su capacidad antes de publicar una ruta."}';
  END IF;
  IF p_origin IS NULL OR char_length(btrim(p_origin)) NOT BETWEEN 2 AND 160
     OR p_destination IS NULL OR char_length(btrim(p_destination)) NOT BETWEEN 2 AND 160
     OR lower(btrim(p_origin)) = lower(btrim(p_destination))
     OR char_length(btrim(COALESCE(p_meeting_point, p_origin))) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Revisa el origen, destino y punto de encuentro."}';
  END IF;
  IF p_departure_at IS NULL OR NOT isfinite(p_departure_at) OR p_departure_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"La fecha y hora del viaje deben ser futuras."}';
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > v_vehicle.capacity THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Los cupos superan la capacidad del vehículo."}';
  END IF;
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 1000000 OR p_price <> round(p_price, 2)
     OR char_length(p_note) > 500 THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Revisa el aporte y la nota de la ruta."}';
  END IF;
  INSERT INTO public.routes(driver_id, vehicle_id, origin, destination, departure_at, seats, price, note, meeting_point)
  VALUES (p_actor, v_vehicle.id, btrim(p_origin), btrim(p_destination), p_departure_at,
    p_seats, p_price, nullif(btrim(p_note), ''), btrim(COALESCE(p_meeting_point, p_origin)))
  RETURNING id INTO v_route;
  RETURN public.route_document(v_route) || jsonb_build_object('meetingPoint', btrim(COALESCE(p_meeting_point, p_origin)));
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_trip_attendance(p_actor uuid, p_route uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_route public.routes; v_attendance public.trip_attendance; v_name text; v_notified integer;
BEGIN
  SELECT * INTO v_route FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;
  IF v_route.status <> 'published' OR v_route.departure_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"La asistencia solo puede confirmarse antes de la salida."}';
  END IF;
  SELECT * INTO v_attendance FROM public.trip_attendance
  WHERE route_id = p_route AND user_id = p_actor FOR UPDATE;
  IF NOT FOUND OR v_attendance.status IN ('released', 'cancelled') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"No participas en esta ruta activa."}';
  END IF;
  UPDATE public.trip_attendance SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
  WHERE route_id = p_route AND user_id = p_actor RETURNING * INTO v_attendance;
  SELECT concat_ws(' ', first_name, last_name) INTO v_name FROM public.profiles WHERE id = p_actor;

  IF v_attendance.role = 'passenger' THEN
    INSERT INTO public.notifications(route_id, recipient_id, type, title, message, metadata)
    VALUES (p_route, v_route.driver_id, 'attendance_confirmed', 'Asistencia confirmada',
      format('%s confirmó su asistencia al viaje de %s a %s.', v_name, v_route.origin, v_route.destination),
      jsonb_build_object('subjectUserId', p_actor, 'action', 'attendance_confirmed'))
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.notifications(route_id, recipient_id, type, title, message, metadata)
    SELECT p_route, b.passenger_id, 'attendance_confirmed', 'El conductor confirmó su asistencia',
      format('%s confirmó su asistencia al viaje de %s a %s.', v_name, v_route.origin, v_route.destination),
      jsonb_build_object('subjectUserId', p_actor, 'action', 'attendance_confirmed')
    FROM public.bookings b WHERE b.route_id = p_route AND b.status = 'confirmed'
    ON CONFLICT DO NOTHING;
  END IF;
  GET DIAGNOSTICS v_notified = ROW_COUNT;
  RETURN jsonb_build_object('routeId', p_route, 'userId', p_actor, 'role', v_attendance.role,
    'status', v_attendance.status, 'confirmedAt', v_attendance.confirmed_at, 'notifiedCounterparts', v_notified);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_unconfirmed_seat(p_actor uuid, p_route uuid, p_passenger uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_route public.routes; v_booking public.bookings;
BEGIN
  SELECT * INTO v_route FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;
  IF v_route.driver_id <> p_actor THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el conductor puede liberar este cupo."}';
  END IF;
  IF v_route.status <> 'published' OR v_route.departure_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"La ruta ya no admite cambios de cupos."}';
  END IF;
  SELECT * INTO v_booking FROM public.bookings
  WHERE route_id = p_route AND passenger_id = p_passenger AND status = 'confirmed' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"No existe una reserva activa para este pasajero."}';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trip_attendance WHERE route_id = p_route AND user_id = p_passenger AND status = 'confirmed') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"El pasajero ya confirmó su asistencia."}';
  END IF;
  UPDATE public.bookings SET status = 'cancelled', updated_at = now() WHERE id = v_booking.id;
  UPDATE public.trip_attendance SET status = 'released', updated_at = now()
  WHERE route_id = p_route AND user_id = p_passenger;
  INSERT INTO public.notifications(route_id, recipient_id, type, title, message, metadata)
  VALUES (p_route, p_passenger, 'seat_released', 'Tu reserva fue liberada',
    format('El conductor liberó tu reserva para la ruta de %s a %s porque no confirmaste asistencia.', v_route.origin, v_route.destination),
    jsonb_build_object('subjectUserId', p_actor, 'action', 'seat_released'))
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('routeId', p_route, 'passengerId', p_passenger,
    'releasedSeats', v_booking.seats, 'status', 'released');
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_trip_reminders(
  p_worker text, p_limit integer DEFAULT 50, p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  id uuid, route_id uuid, recipient_id uuid, subject_user_id uuid, kind text,
  origin text, destination text, meeting_point text, departure_at timestamptz,
  recipient_name text, attendance_role text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.trip_reminder_deliveries(route_id, recipient_id, kind, available_at)
  SELECT r.id, a.user_id, '24h', p_now
  FROM public.routes r JOIN public.trip_attendance a ON a.route_id = r.id
  WHERE r.status = 'published' AND r.departure_at > p_now + interval '1 hour'
    AND r.departure_at <= p_now + interval '24 hours'
    AND a.status NOT IN ('released', 'cancelled')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.trip_reminder_deliveries(route_id, recipient_id, kind, available_at)
  SELECT r.id, a.user_id, '1h', p_now
  FROM public.routes r JOIN public.trip_attendance a ON a.route_id = r.id
  WHERE r.status = 'published' AND r.departure_at > p_now
    AND r.departure_at <= p_now + interval '1 hour'
    AND a.status NOT IN ('released', 'cancelled')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.trip_reminder_deliveries(route_id, recipient_id, kind, available_at)
  SELECT DISTINCT r.id, r.driver_id, '30m_missing', p_now
  FROM public.routes r JOIN public.trip_attendance a ON a.route_id = r.id AND a.role = 'passenger'
  WHERE r.status = 'published' AND r.departure_at > p_now
    AND r.departure_at <= p_now + interval '30 minutes'
    AND a.status IN ('pending', 'release_suggested')
  ON CONFLICT DO NOTHING;

  UPDATE public.trip_reminder_deliveries d SET status = 'failed', worker_id = NULL,
    available_at = p_now, last_error = 'Reintento después de bloqueo vencido'
  WHERE d.status = 'processing' AND d.claimed_at < p_now - interval '10 minutes' AND d.attempts < 5;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id FROM public.trip_reminder_deliveries d
    WHERE d.status IN ('pending', 'failed') AND d.available_at <= p_now AND d.attempts < 5
    ORDER BY d.available_at, d.created_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ), claimed AS (
    UPDATE public.trip_reminder_deliveries d SET status = 'processing', claimed_at = p_now,
      worker_id = p_worker, attempts = d.attempts + 1, last_error = NULL
    FROM candidates c WHERE d.id = c.id RETURNING d.*
  )
  SELECT c.id, c.route_id, c.recipient_id, c.subject_user_id, c.kind,
    r.origin, r.destination, r.meeting_point, r.departure_at,
    concat_ws(' ', p.first_name, p.last_name), a.role
  FROM claimed c JOIN public.routes r ON r.id = c.route_id
  JOIN public.profiles p ON p.id = c.recipient_id
  LEFT JOIN public.trip_attendance a ON a.route_id = c.route_id AND a.user_id = c.recipient_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_trip_reminder_delivery(
  p_delivery uuid, p_success boolean, p_error text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.trip_reminder_deliveries SET
    status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
    sent_at = CASE WHEN p_success THEN now() ELSE sent_at END,
    available_at = CASE WHEN p_success THEN available_at ELSE now() + (attempts * interval '2 minutes') END,
    last_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'Error de envío'), 1000) END,
    worker_id = NULL
  WHERE id = p_delivery AND status = 'processing';
END;
$$;

REVOKE ALL ON FUNCTION public.create_route_v2(uuid,text,text,timestamptz,integer,numeric,text,text),
  public.confirm_trip_attendance(uuid,uuid), public.release_unconfirmed_seat(uuid,uuid,uuid),
  public.claim_due_trip_reminders(text,integer,timestamptz),
  public.complete_trip_reminder_delivery(uuid,boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_route_v2(uuid,text,text,timestamptz,integer,numeric,text,text),
  public.confirm_trip_attendance(uuid,uuid), public.release_unconfirmed_seat(uuid,uuid,uuid),
  public.claim_due_trip_reminders(text,integer,timestamptz),
  public.complete_trip_reminder_delivery(uuid,boolean,text)
  TO service_role;

COMMIT;
