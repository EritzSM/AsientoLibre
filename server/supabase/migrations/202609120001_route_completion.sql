-- Asiento Libre: finalizacion independiente por conductor y pasajero.
BEGIN;

ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS driver_finished_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS passenger_finished_at timestamptz;

-- route_catalog was created before the completion columns existed. Replacing it
-- explicitly keeps its original API and exposes the new driver timestamp.
CREATE OR REPLACE VIEW public.route_catalog WITH (security_invoker = true) AS
SELECT r.id, r.driver_id, r.vehicle_id, r.origin, r.destination, r.departure_at,
       r.seats, r.price, r.note, r.status, r.created_at, r.updated_at,
       concat_ws(' ', p.first_name, p.last_name) AS driver_name,
       r.seats - COALESCE(b.reserved_seats, 0)::integer AS available_seats,
       COALESCE(b.confirmed_passengers, 0)::integer AS confirmed_passengers,
       r.driver_finished_at
FROM public.routes r
JOIN public.profiles p ON p.id = r.driver_id
LEFT JOIN LATERAL (
  SELECT sum(seats) AS reserved_seats, count(*) AS confirmed_passengers
  FROM public.bookings WHERE route_id = r.id AND status = 'confirmed'
) b ON true;

CREATE OR REPLACE FUNCTION public.route_document(p_route uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', id, 'driverId', driver_id, 'driverName', driver_name,
    'origin', origin, 'destination', destination,
    'date', to_char(departure_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD'),
    'time', to_char(departure_at AT TIME ZONE 'America/Bogota', 'HH24:MI'),
    'seats', seats, 'availableSeats', available_seats, 'price', price, 'note', note,
    'status', status, 'confirmedPassengers', confirmed_passengers,
    'driverFinishedAt', driver_finished_at, 'passengerFinishedAt', NULL,
    'createdAt', created_at
  ) FROM public.route_catalog WHERE id = p_route;
$$;

CREATE OR REPLACE FUNCTION public.finish_route(p_actor uuid, p_route uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_route public.routes;
  v_booking public.bookings;
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_actor;
  SELECT * INTO v_route FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;
  IF v_route.status <> 'published' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Esta ruta ya no está activa."}';
  END IF;
  IF v_route.departure_at > now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"La ruta todavía no ha comenzado."}';
  END IF;

  IF v_route.driver_id = p_actor AND v_role = 'conductor' THEN
    UPDATE public.routes SET driver_finished_at = COALESCE(driver_finished_at, now()), updated_at = now()
    WHERE id = p_route
    RETURNING * INTO v_route;
    RETURN jsonb_build_object('routeId', p_route, 'role', 'driver', 'driverFinishedAt', v_route.driver_finished_at,
      'passengerFinishedAt', (SELECT min(passenger_finished_at) FROM public.bookings WHERE route_id = p_route AND status = 'confirmed'));
  END IF;

  IF v_role = 'pasajero' THEN
    SELECT * INTO v_booking FROM public.bookings
    WHERE route_id = p_route AND passenger_id = p_actor AND status = 'confirmed' FOR UPDATE;
    IF FOUND THEN
      UPDATE public.bookings SET passenger_finished_at = COALESCE(passenger_finished_at, now()), updated_at = now()
      WHERE id = v_booking.id
      RETURNING * INTO v_booking;
      RETURN jsonb_build_object('routeId', p_route, 'role', 'passenger', 'driverFinishedAt', v_route.driver_finished_at,
        'passengerFinishedAt', v_booking.passenger_finished_at);
    END IF;
  END IF;

  RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo puedes finalizar una ruta en la que participas."}';
END;
$$;

REVOKE ALL ON FUNCTION public.finish_route(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_route(uuid,uuid) TO service_role;

COMMIT;