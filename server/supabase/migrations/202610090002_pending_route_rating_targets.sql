-- Allow participants to retrieve outstanding anonymous ratings after finishing
-- even when an older finish_route function does not return rating targets.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_pending_route_rating_targets(p_actor uuid, p_route uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_route public.routes;
  v_booking public.bookings;
  v_role text;
  v_targets jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_actor;
  SELECT * INTO v_route FROM public.routes WHERE id = p_route;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;

  IF v_role = 'conductor' AND v_route.driver_id = p_actor AND v_route.driver_finished_at IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name))
      ORDER BY p.first_name, p.last_name), '[]'::jsonb) INTO v_targets
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.passenger_id
    WHERE b.route_id = p_route AND b.status = 'confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM public.route_ratings rr
        WHERE rr.route_id = p_route AND rr.reviewer_id = p_actor AND rr.rated_id = b.passenger_id
      );
    RETURN v_targets;
  END IF;

  IF v_role = 'pasajero' THEN
    SELECT * INTO v_booking FROM public.bookings
    WHERE route_id = p_route AND passenger_id = p_actor AND status = 'confirmed'
      AND passenger_finished_at IS NOT NULL;
    IF FOUND THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name))),
        '[]'::jsonb) INTO v_targets
      FROM public.profiles p
      WHERE p.id = v_route.driver_id
        AND NOT EXISTS (
          SELECT 1 FROM public.route_ratings rr
          WHERE rr.route_id = p_route AND rr.reviewer_id = p_actor AND rr.rated_id = v_route.driver_id
        );
      RETURN v_targets;
    END IF;
  END IF;

  RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Debes finalizar tu participación antes de consultar calificaciones pendientes."}';
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_route_rating_targets(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_route_rating_targets(uuid,uuid) TO service_role;

COMMIT;
