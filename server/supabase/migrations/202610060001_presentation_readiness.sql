-- Asiento Libre: compatibilidad entre pagos, calificaciones y panel administrativo.
BEGIN;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('pasajero', 'conductor', 'admin'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_type') THEN
    CREATE TYPE public.document_type AS ENUM ('licencia', 'soat', 'cedula', 'foto_vehiculo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_status') THEN
    CREATE TYPE public.document_status AS ENUM ('pendiente', 'aprobado', 'rechazado');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.conductor_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conductor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type public.document_type NOT NULL,
  file_url text NOT NULL,
  file_name text,
  status public.document_status NOT NULL DEFAULT 'pendiente',
  rejection_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT conductor_documents_rejection_consistency CHECK (
    status = 'rechazado' OR rejection_reason IS NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_conductor_documents_conductor_id ON public.conductor_documents(conductor_id);
CREATE INDEX IF NOT EXISTS idx_conductor_documents_status ON public.conductor_documents(status);
ALTER TABLE public.conductor_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conductor_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conductor_documents TO service_role;

ALTER TABLE public.trip_payments DROP CONSTRAINT IF EXISTS trip_payments_passenger_id_fkey;
ALTER TABLE public.trip_payments DROP CONSTRAINT IF EXISTS trip_payments_confirmed_by_fkey;
ALTER TABLE public.trip_payments ADD CONSTRAINT trip_payments_passenger_id_fkey
  FOREIGN KEY (passenger_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.trip_payments ADD CONSTRAINT trip_payments_confirmed_by_fkey
  FOREIGN KEY (confirmed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.finish_route(p_actor uuid, p_route uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_route public.routes;
  v_booking public.bookings;
  v_role text;
  v_targets jsonb;
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
    WHERE id = p_route RETURNING * INTO v_route;

    INSERT INTO public.trip_payments (booking_id, route_id, passenger_id, amount)
    SELECT b.id, b.route_id, b.passenger_id, v_route.price * b.seats
    FROM public.bookings b
    WHERE b.route_id = p_route AND b.status = 'confirmed'
    ON CONFLICT (booking_id) DO NOTHING;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name)
    ) ORDER BY p.first_name, p.last_name), '[]'::jsonb) INTO v_targets
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.passenger_id
    WHERE b.route_id = p_route AND b.status = 'confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM public.route_ratings rr
        WHERE rr.route_id = p_route AND rr.reviewer_id = p_actor AND rr.rated_id = b.passenger_id
      );

    RETURN jsonb_build_object(
      'routeId', p_route, 'role', 'driver', 'driverFinishedAt', v_route.driver_finished_at,
      'passengerFinishedAt', (SELECT min(passenger_finished_at) FROM public.bookings
        WHERE route_id = p_route AND status = 'confirmed'),
      'ratingTargets', v_targets
    );
  END IF;

  IF v_role = 'pasajero' THEN
    SELECT * INTO v_booking FROM public.bookings
    WHERE route_id = p_route AND passenger_id = p_actor AND status = 'confirmed' FOR UPDATE;
    IF FOUND THEN
      UPDATE public.bookings SET passenger_finished_at = COALESCE(passenger_finished_at, now()), updated_at = now()
      WHERE id = v_booking.id RETURNING * INTO v_booking;
      SELECT jsonb_build_array(jsonb_build_object(
        'id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name)
      )) INTO v_targets
      FROM public.profiles p
      WHERE p.id = v_route.driver_id
        AND NOT EXISTS (
          SELECT 1 FROM public.route_ratings rr
          WHERE rr.route_id = p_route AND rr.reviewer_id = p_actor AND rr.rated_id = v_route.driver_id
        );
      RETURN jsonb_build_object(
        'routeId', p_route, 'role', 'passenger', 'driverFinishedAt', v_route.driver_finished_at,
        'passengerFinishedAt', v_booking.passenger_finished_at,
        'ratingTargets', COALESCE(v_targets, '[]'::jsonb)
      );
    END IF;
  END IF;

  RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo puedes finalizar una ruta en la que participas."}';
END;
$$;

REVOKE ALL ON FUNCTION public.finish_route(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_route(uuid,uuid) TO service_role;

COMMIT;
