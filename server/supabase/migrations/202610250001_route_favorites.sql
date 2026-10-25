-- HU-12: reusable favorite journeys and notifications for new matching routes.
BEGIN;

-- Keep payments compatible with bookings created by the original reservation RPC,
-- whose promotion columns default to zero.
CREATE OR REPLACE FUNCTION public.apply_booking_total_to_trip_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT CASE
    WHEN b.promotion_id IS NULL
      AND b.total_amount = 0
      AND b.discount_amount = 0
      AND r.price > 0
      THEN round(r.price * b.seats, 2)
    ELSE b.total_amount
  END INTO NEW.amount
  FROM public.bookings b
  JOIN public.routes r ON r.id = b.route_id
  WHERE b.id = NEW.booking_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_route_place(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g'));
$$;

CREATE TABLE IF NOT EXISTS public.route_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (char_length(btrim(origin)) BETWEEN 2 AND 160),
  destination text NOT NULL CHECK (char_length(btrim(destination)) BETWEEN 2 AND 160),
  origin_key text GENERATED ALWAYS AS (public.normalize_route_place(origin)) STORED,
  destination_key text GENERATED ALWAYS AS (public.normalize_route_place(destination)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_favorites_distinct_places CHECK (origin_key <> destination_key),
  CONSTRAINT route_favorites_passenger_journey_unique UNIQUE (passenger_id, origin_key, destination_key)
);

CREATE INDEX IF NOT EXISTS route_favorites_journey_idx
  ON public.route_favorites(origin_key, destination_key);
CREATE INDEX IF NOT EXISTS route_favorites_passenger_idx
  ON public.route_favorites(passenger_id, created_at DESC);

ALTER TABLE public.route_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_favorites FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.route_favorites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.route_favorites TO service_role;

CREATE OR REPLACE FUNCTION public.save_route_favorite(p_actor uuid, p_route uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_route public.routes;
  v_favorite public.route_favorites;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'pasajero' AND is_active) THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo un pasajero activo puede guardar rutas favoritas."}';
  END IF;

  SELECT * INTO v_route FROM public.routes WHERE id = p_route;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;

  INSERT INTO public.route_favorites(passenger_id, source_route_id, origin, destination)
  VALUES (p_actor, p_route, v_route.origin, v_route.destination)
  ON CONFLICT (passenger_id, origin_key, destination_key)
  DO UPDATE SET source_route_id = EXCLUDED.source_route_id, updated_at = now()
  RETURNING * INTO v_favorite;

  RETURN jsonb_build_object(
    'id', v_favorite.id,
    'origin', v_favorite.origin,
    'destination', v_favorite.destination,
    'sourceRouteId', v_favorite.source_route_id,
    'createdAt', v_favorite.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_route_favorite(p_actor uuid, p_favorite uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted uuid;
BEGIN
  DELETE FROM public.route_favorites
  WHERE id = p_favorite AND passenger_id = p_actor
  RETURNING id INTO v_deleted;

  IF v_deleted IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta favorita no existe."}';
  END IF;
  RETURN jsonb_build_object('id', v_deleted, 'removed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_route_place(text),
  public.save_route_favorite(uuid,uuid), public.remove_route_favorite(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_route_place(text),
  public.save_route_favorite(uuid,uuid), public.remove_route_favorite(uuid,uuid)
  TO service_role;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'trip_reminder_24h', 'trip_reminder_1h', 'attendance_confirmed', 'attendance_missing',
  'seat_released', 'booking_requested', 'booking_confirmed', 'booking_accepted',
  'booking_rejected', 'booking_cancelled', 'new_booking', 'route_cancelled_passenger',
  'route_cancelled', 'time_changed', 'document_aprobado', 'document_rechazado',
  'document_revision_manual', 'document_pendiente', 'favorite_route_available'
)) NOT VALID;

COMMIT;
