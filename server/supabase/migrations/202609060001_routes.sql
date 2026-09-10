-- Asiento Libre: publicación, reservas y cancelación transaccional.
-- Ejecutar después de supabase/schema.sql en el SQL Editor de Supabase.
-- Capacidad = asientos de pasajeros, SIN contar al conductor.
-- Las capacidades anteriores permanecen NULL hasta que el conductor las registre.
BEGIN;

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS capacity integer;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_capacity_check CHECK (capacity BETWEEN 1 AND 8);

CREATE TABLE public.routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.profiles(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  origin text NOT NULL CHECK (char_length(btrim(origin)) BETWEEN 2 AND 160),
  destination text NOT NULL CHECK (char_length(btrim(destination)) BETWEEN 2 AND 160),
  departure_at timestamptz NOT NULL,
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 8),
  price numeric(12,2) NOT NULL DEFAULT 0 CHECK (price BETWEEN 0 AND 1000000),
  note text CHECK (char_length(note) <= 500),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'deleted', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routes_different_places CHECK (lower(btrim(origin)) <> lower(btrim(destination)))
);

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.routes(id),
  passenger_id uuid NOT NULL REFERENCES public.profiles(id),
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 8),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_route_passenger_unique UNIQUE (route_id, passenger_id)
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.routes(id),
  recipient_id uuid NOT NULL REFERENCES public.profiles(id),
  type text NOT NULL CHECK (type = 'route_cancelled'),
  title text NOT NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_route_recipient_type_unique UNIQUE (route_id, recipient_id, type)
);

CREATE INDEX routes_departure_published_idx ON public.routes (departure_at) WHERE status = 'published';
CREATE INDEX routes_driver_departure_idx ON public.routes (driver_id, departure_at DESC);
CREATE INDEX bookings_passenger_idx ON public.bookings (passenger_id, created_at DESC);
CREATE INDEX bookings_confirmed_route_idx ON public.bookings (route_id) WHERE status = 'confirmed';
CREATE INDEX notifications_recipient_idx ON public.notifications (recipient_id, created_at DESC);

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- All public API writes go through NestJS and service-only RPC functions.
-- Revoking legacy profile writes also prevents self-promotion to conductor.
REVOKE INSERT, UPDATE, DELETE ON public.profiles, public.vehicles FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.profiles, public.vehicles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, first_name, last_name, role, created_at, updated_at) ON public.profiles TO authenticated;
GRANT SELECT (id, user_id, brand, model, color, plate, capacity, created_at, updated_at) ON public.vehicles TO authenticated;
REVOKE ALL ON public.routes, public.bookings, public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routes, public.bookings, public.notifications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.vehicles TO service_role;

CREATE VIEW public.route_catalog WITH (security_invoker = true) AS
SELECT r.*, concat_ws(' ', p.first_name, p.last_name) AS driver_name,
       r.seats - COALESCE(b.reserved_seats, 0)::integer AS available_seats,
       COALESCE(b.confirmed_passengers, 0)::integer AS confirmed_passengers
FROM public.routes r
JOIN public.profiles p ON p.id = r.driver_id
LEFT JOIN LATERAL (
  SELECT sum(seats) AS reserved_seats, count(*) AS confirmed_passengers
  FROM public.bookings WHERE route_id = r.id AND status = 'confirmed'
) b ON true;
REVOKE ALL ON public.route_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.route_catalog TO service_role;

CREATE FUNCTION public.route_document(p_route uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', id, 'driverId', driver_id, 'driverName', driver_name,
    'origin', origin, 'destination', destination,
    'date', to_char(departure_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD'),
    'time', to_char(departure_at AT TIME ZONE 'America/Bogota', 'HH24:MI'),
    'seats', seats, 'availableSeats', available_seats, 'price', price, 'note', note,
    'status', status, 'confirmedPassengers', confirmed_passengers, 'createdAt', created_at
  ) FROM public.route_catalog WHERE id = p_route;
$$;

CREATE FUNCTION public.save_vehicle(p_actor uuid, p_brand text, p_model text, p_color text, p_plate text, p_capacity integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text; v_vehicle public.vehicles;
BEGIN
  -- Both vehicle changes and route creation lock this same profile first.
  SELECT role INTO v_role FROM public.profiles WHERE id = p_actor FOR UPDATE;
  IF v_role IS DISTINCT FROM 'conductor' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo un conductor puede registrar un vehículo."}';
  END IF;
  IF p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 8
     OR p_brand IS NULL OR char_length(btrim(p_brand)) NOT BETWEEN 2 AND 60
     OR p_model IS NULL OR char_length(btrim(p_model)) NOT BETWEEN 1 AND 60
     OR p_color IS NULL OR char_length(btrim(p_color)) NOT BETWEEN 2 AND 40
     OR p_plate IS NULL OR upper(btrim(p_plate)) !~ '^[A-Z]{3}[0-9]{3}$' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Revisa los datos del vehículo y su capacidad de pasajeros (1 a 8)."}';
  END IF;
  IF EXISTS (SELECT 1 FROM public.routes WHERE driver_id = p_actor AND status = 'published' AND departure_at > now() AND seats > p_capacity) THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"No puedes reducir la capacidad por debajo de los cupos de tus rutas activas."}';
  END IF;
  INSERT INTO public.vehicles (user_id, brand, model, color, plate, capacity)
  VALUES (p_actor, btrim(p_brand), btrim(p_model), btrim(p_color), upper(btrim(p_plate)), p_capacity)
  ON CONFLICT (user_id) DO UPDATE SET brand = EXCLUDED.brand, model = EXCLUDED.model,
    color = EXCLUDED.color, plate = EXCLUDED.plate, capacity = EXCLUDED.capacity, updated_at = now()
  RETURNING * INTO v_vehicle;
  RETURN jsonb_build_object('id', v_vehicle.id, 'brand', v_vehicle.brand, 'model', v_vehicle.model,
    'color', v_vehicle.color, 'plate', v_vehicle.plate, 'capacity', v_vehicle.capacity);
END;
$$;

CREATE FUNCTION public.create_route(p_actor uuid, p_origin text, p_destination text, p_departure_at timestamptz,
  p_seats integer, p_price numeric DEFAULT 0, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text; v_vehicle public.vehicles; v_route uuid;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_actor FOR UPDATE;
  IF v_role IS DISTINCT FROM 'conductor' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo un conductor puede publicar rutas."}';
  END IF;
  SELECT * INTO v_vehicle FROM public.vehicles WHERE user_id = p_actor FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Registra tu vehículo antes de publicar una ruta."}';
  END IF;
  IF v_vehicle.capacity IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Completa la capacidad de pasajeros de tu vehículo antes de publicar."}';
  END IF;
  IF p_origin IS NULL OR char_length(btrim(p_origin)) NOT BETWEEN 2 AND 160
     OR p_destination IS NULL OR char_length(btrim(p_destination)) NOT BETWEEN 2 AND 160
     OR lower(btrim(p_origin)) = lower(btrim(p_destination)) THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Ingresa un origen y un destino válidos y diferentes."}';
  END IF;
  IF p_departure_at IS NULL OR NOT isfinite(p_departure_at) OR p_departure_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"La fecha y hora del viaje deben ser futuras."}';
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > v_vehicle.capacity THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Los cupos deben estar entre 1 y la capacidad de pasajeros del vehículo."}';
  END IF;
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 1000000 OR p_price <> round(p_price, 2) OR char_length(p_note) > 500 THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"El aporte debe estar entre 0 y 1.000.000 COP (máximo dos decimales) y la nota no puede superar 500 caracteres."}';
  END IF;
  INSERT INTO public.routes (driver_id, vehicle_id, origin, destination, departure_at, seats, price, note)
  VALUES (p_actor, v_vehicle.id, btrim(p_origin), btrim(p_destination), p_departure_at, p_seats, p_price, nullif(btrim(p_note), ''))
  RETURNING id INTO v_route;
  RETURN public.route_document(v_route);
END;
$$;

CREATE FUNCTION public.book_route(p_actor uuid, p_route uuid, p_seats integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_route public.routes; v_reserved integer; v_booking public.bookings;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'pasajero') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo un pasajero puede reservar cupos."}';
  END IF;
  -- Booking and cancellation serialize on the route, preventing overbooking and lost notices.
  SELECT * INTO v_route FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;
  IF v_route.driver_id = p_actor THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"No puedes reservar tu propia ruta."}';
  END IF;
  IF v_route.status <> 'published' OR v_route.departure_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Esta ruta ya no está disponible para reservar."}';
  END IF;
  IF p_seats IS NULL OR p_seats NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Debes reservar una cantidad entera de cupos entre 1 y 8."}';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE route_id = p_route AND passenger_id = p_actor;
  IF FOUND THEN
    IF v_booking.status = 'confirmed' AND v_booking.seats = p_seats THEN
      RETURN jsonb_build_object('id', v_booking.id, 'routeId', p_route, 'seats', v_booking.seats, 'status', v_booking.status, 'createdAt', v_booking.created_at);
    END IF;
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Ya tienes una reserva para esta ruta."}';
  END IF;
  SELECT COALESCE(sum(seats), 0)::integer INTO v_reserved FROM public.bookings WHERE route_id = p_route AND status = 'confirmed';
  IF p_seats > v_route.seats - v_reserved THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"No hay suficientes cupos disponibles."}';
  END IF;
  INSERT INTO public.bookings (route_id, passenger_id, seats) VALUES (p_route, p_actor, p_seats) RETURNING * INTO v_booking;
  RETURN jsonb_build_object('id', v_booking.id, 'routeId', p_route, 'seats', v_booking.seats, 'status', v_booking.status, 'createdAt', v_booking.created_at);
END;
$$;

CREATE FUNCTION public.remove_route(p_actor uuid, p_route uuid, p_confirm_cancel boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_route public.routes; v_confirmed integer; v_notified integer; v_status text;
BEGIN
  SELECT * INTO v_route FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;
  IF v_route.driver_id IS DISTINCT FROM p_actor OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'conductor') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el conductor propietario puede eliminar o cancelar esta ruta."}';
  END IF;
  IF v_route.status <> 'published' THEN
    SELECT count(*)::integer INTO v_notified FROM public.notifications WHERE route_id = p_route AND type = 'route_cancelled';
    RETURN jsonb_build_object('message', 'La ruta ya fue retirada.', 'status', v_route.status, 'notifiedPassengers', v_notified);
  END IF;
  SELECT count(*)::integer INTO v_confirmed FROM public.bookings WHERE route_id = p_route AND status = 'confirmed';
  IF v_confirmed > 0 AND p_confirm_cancel IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING MESSAGE = jsonb_build_object('code', 'CANCELLATION_CONFIRMATION_REQUIRED',
      'message', 'Esta ruta tiene pasajeros confirmados. Confirma la cancelación para notificarlos.', 'confirmedPassengers', v_confirmed)::text;
  END IF;
  v_status := CASE WHEN p_confirm_cancel IS TRUE THEN 'cancelled' ELSE 'deleted' END;
  UPDATE public.routes SET status = v_status, updated_at = now() WHERE id = p_route;
  IF v_status = 'cancelled' THEN
    INSERT INTO public.notifications (route_id, recipient_id, type, title, message)
    SELECT p_route, passenger_id, 'route_cancelled', 'Tu viaje fue cancelado',
      format('El conductor canceló la ruta de %s a %s del %s a las %s (hora de Colombia). Tu reserva fue cancelada.',
        v_route.origin, v_route.destination,
        to_char(v_route.departure_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'),
        to_char(v_route.departure_at AT TIME ZONE 'America/Bogota', 'HH24:MI'))
    FROM public.bookings WHERE route_id = p_route AND status = 'confirmed'
    ON CONFLICT (route_id, recipient_id, type) DO NOTHING;
    UPDATE public.bookings SET status = 'cancelled', updated_at = now() WHERE route_id = p_route AND status = 'confirmed';
  END IF;
  SELECT count(*)::integer INTO v_notified FROM public.notifications WHERE route_id = p_route AND type = 'route_cancelled';
  RETURN jsonb_build_object('message', CASE WHEN v_status = 'cancelled' THEN 'Ruta cancelada y pasajeros notificados.' ELSE 'Ruta eliminada.' END,
    'status', v_status, 'notifiedPassengers', v_notified);
END;
$$;

CREATE FUNCTION public.mark_notification_read(p_actor uuid, p_notification uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_notification public.notifications;
BEGIN
  UPDATE public.notifications SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification AND recipient_id = p_actor RETURNING * INTO v_notification;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La notificación no existe."}';
  END IF;
  RETURN jsonb_build_object('id', v_notification.id, 'routeId', v_notification.route_id, 'type', v_notification.type,
    'title', v_notification.title, 'message', v_notification.message, 'readAt', v_notification.read_at, 'createdAt', v_notification.created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.route_document(uuid), public.save_vehicle(uuid,text,text,text,text,integer),
  public.create_route(uuid,text,text,timestamptz,integer,numeric,text), public.book_route(uuid,uuid,integer),
  public.remove_route(uuid,uuid,boolean), public.mark_notification_read(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.route_document(uuid), public.save_vehicle(uuid,text,text,text,text,integer),
  public.create_route(uuid,text,text,timestamptz,integer,numeric,text), public.book_route(uuid,uuid,integer),
  public.remove_route(uuid,uuid,boolean), public.mark_notification_read(uuid,uuid) TO service_role;

COMMIT;
