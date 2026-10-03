-- Asiento Libre: snapshot and confirmation of passenger contributions.
BEGIN;

CREATE TABLE IF NOT EXISTS public.trip_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES public.profiles(id),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_payments_confirmation_consistency CHECK (
    (status = 'pending' AND confirmed_at IS NULL AND confirmed_by IS NULL)
    OR (status = 'confirmed' AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS trip_payments_driver_status_idx
  ON public.trip_payments(route_id, status);
CREATE INDEX IF NOT EXISTS trip_payments_passenger_idx
  ON public.trip_payments(passenger_id, created_at DESC);

DROP TRIGGER IF EXISTS tr_trip_payments_updated_at ON public.trip_payments;
CREATE TRIGGER tr_trip_payments_updated_at
  BEFORE UPDATE ON public.trip_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.trip_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_payments TO service_role;

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
    IF v_route.driver_finished_at IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Este viaje ya fue finalizado."}';
    END IF;
    UPDATE public.routes SET driver_finished_at = COALESCE(driver_finished_at, now()), updated_at = now()
    WHERE id = p_route RETURNING * INTO v_route;

    INSERT INTO public.trip_payments (booking_id, route_id, passenger_id, amount)
    SELECT b.id, b.route_id, b.passenger_id, v_route.price * b.seats
    FROM public.bookings b
    WHERE b.route_id = p_route AND b.status = 'confirmed'
    ON CONFLICT (booking_id) DO NOTHING;

    RETURN jsonb_build_object('routeId', p_route, 'role', 'driver',
      'driverFinishedAt', v_route.driver_finished_at,
      'passengerFinishedAt', (SELECT min(passenger_finished_at)
        FROM public.bookings WHERE route_id = p_route AND status = 'confirmed'));
  END IF;

  IF v_role = 'pasajero' THEN
    SELECT * INTO v_booking FROM public.bookings
    WHERE route_id = p_route AND passenger_id = p_actor AND status = 'confirmed' FOR UPDATE;
    IF FOUND THEN
      UPDATE public.bookings SET passenger_finished_at = COALESCE(passenger_finished_at, now()), updated_at = now()
      WHERE id = v_booking.id RETURNING * INTO v_booking;
      RETURN jsonb_build_object('routeId', p_route, 'role', 'passenger',
        'driverFinishedAt', v_route.driver_finished_at,
        'passengerFinishedAt', v_booking.passenger_finished_at);
    END IF;
  END IF;

  RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo puedes finalizar una ruta en la que participas."}';
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_trip_payment(p_actor uuid, p_payment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payment public.trip_payments;
  v_route public.routes;
BEGIN
  SELECT * INTO v_payment FROM public.trip_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"El pago no existe."}';
  END IF;
  SELECT * INTO v_route FROM public.routes WHERE id = v_payment.route_id;
  IF v_route.driver_id IS DISTINCT FROM p_actor
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'conductor') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el conductor propietario puede confirmar este pago."}';
  END IF;
  IF v_route.driver_finished_at IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Finaliza el viaje antes de confirmar pagos."}';
  END IF;
  IF v_payment.status = 'confirmed' THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"Este pago ya fue confirmado."}';
  END IF;

  UPDATE public.trip_payments
  SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_actor, updated_at = now()
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;
  RETURN jsonb_build_object('id', v_payment.id, 'bookingId', v_payment.booking_id,
    'routeId', v_payment.route_id, 'passengerId', v_payment.passenger_id,
    'amount', v_payment.amount, 'status', v_payment.status,
    'confirmedAt', v_payment.confirmed_at, 'confirmedBy', v_payment.confirmed_by);
END;
$$;

REVOKE ALL ON FUNCTION public.finish_route(uuid,uuid), public.confirm_trip_payment(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_route(uuid,uuid), public.confirm_trip_payment(uuid,uuid)
  TO service_role;

COMMIT;
