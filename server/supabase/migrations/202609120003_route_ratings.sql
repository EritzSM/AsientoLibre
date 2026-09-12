-- Asiento Libre: calificaciones anonimas posteriores a una ruta.
BEGIN;

CREATE TABLE IF NOT EXISTS public.route_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.routes(id),
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
  rated_id uuid NOT NULL REFERENCES public.profiles(id),
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_ratings_reviewer_target_distinct CHECK (reviewer_id <> rated_id),
  CONSTRAINT route_ratings_unique_review UNIQUE (route_id, reviewer_id, rated_id)
);

CREATE INDEX IF NOT EXISTS route_ratings_rated_idx ON public.route_ratings (rated_id, created_at DESC);
ALTER TABLE public.route_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.route_ratings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_ratings TO service_role;

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
    WHERE id = p_route
    RETURNING * INTO v_route;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name))
      ORDER BY p.first_name, p.last_name), '[]'::jsonb) INTO v_targets
    FROM public.bookings b JOIN public.profiles p ON p.id = b.passenger_id
    WHERE b.route_id = p_route AND b.status = 'confirmed';
    RETURN jsonb_build_object('routeId', p_route, 'role', 'driver', 'driverFinishedAt', v_route.driver_finished_at,
      'ratingTargets', v_targets);
  END IF;

  IF v_role = 'pasajero' THEN
    SELECT * INTO v_booking FROM public.bookings
    WHERE route_id = p_route AND passenger_id = p_actor AND status = 'confirmed' FOR UPDATE;
    IF FOUND THEN
      UPDATE public.bookings SET passenger_finished_at = COALESCE(passenger_finished_at, now()), updated_at = now()
      WHERE id = v_booking.id
      RETURNING * INTO v_booking;
      SELECT jsonb_build_array(jsonb_build_object('id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name)))
      INTO v_targets FROM public.profiles p WHERE p.id = v_route.driver_id;
      RETURN jsonb_build_object('routeId', p_route, 'role', 'passenger', 'passengerFinishedAt', v_booking.passenger_finished_at,
        'ratingTargets', COALESCE(v_targets, '[]'::jsonb));
    END IF;
  END IF;

  RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo puedes finalizar una ruta en la que participas."}';
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_route_rating(
  p_actor uuid, p_route uuid, p_rated uuid, p_score smallint, p_comment text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_route public.routes;
  v_booking public.bookings;
  v_rating public.route_ratings;
  v_role text;
BEGIN
  IF p_score IS NULL OR p_score NOT BETWEEN 1 AND 5 OR char_length(p_comment) > 500 THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"La calificación debe estar entre 1 y 5 y el comentario no puede superar 500 caracteres."}';
  END IF;
  IF p_actor = p_rated THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"No puedes calificarte a ti mismo."}';
  END IF;
  SELECT * INTO v_route FROM public.routes WHERE id = p_route;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = p_actor;

  IF v_role = 'conductor' AND v_route.driver_id = p_actor AND v_route.driver_finished_at IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE route_id = p_route AND passenger_id = p_rated AND status = 'confirmed') THEN
      RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo puedes calificar a pasajeros de esta ruta."}';
    END IF;
  ELSIF v_role = 'pasajero' THEN
    SELECT * INTO v_booking FROM public.bookings WHERE route_id = p_route AND passenger_id = p_actor
      AND status = 'confirmed' AND passenger_finished_at IS NOT NULL;
    IF NOT FOUND OR v_route.driver_id <> p_rated THEN
      RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo puedes calificar al conductor de tu ruta después de finalizarla."}';
    END IF;
  ELSE
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Debes finalizar tu participación antes de calificar."}';
  END IF;

  SELECT * INTO v_rating FROM public.route_ratings
  WHERE route_id = p_route AND reviewer_id = p_actor AND rated_id = p_rated;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_rating.id, 'routeId', p_route, 'ratedId', p_rated, 'score', v_rating.score,
      'comment', v_rating.comment, 'createdAt', v_rating.created_at);
  END IF;

  INSERT INTO public.route_ratings (route_id, reviewer_id, rated_id, score, comment)
  VALUES (p_route, p_actor, p_rated, p_score, nullif(btrim(p_comment), ''))
  RETURNING * INTO v_rating;
  RETURN jsonb_build_object('id', v_rating.id, 'routeId', p_route, 'ratedId', p_rated, 'score', v_rating.score,
    'comment', v_rating.comment, 'createdAt', v_rating.created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.finish_route(uuid,uuid), public.submit_route_rating(uuid,uuid,uuid,smallint,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_route(uuid,uuid), public.submit_route_rating(uuid,uuid,uuid,smallint,text)
  TO service_role;

COMMIT;




