-- HU-14: active promotions and immutable booking price snapshots.
BEGIN;

CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 2 AND 500),
  code text,
  discount_type text NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value numeric(12,2) NOT NULL CHECK (
    (discount_type = 'percentage' AND discount_value > 0 AND discount_value <= 100)
    OR (discount_type = 'fixed' AND discount_value > 0 AND discount_value <= 1000000)
  ),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotions_valid_period CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX promotions_code_unique ON public.promotions (upper(code))
  WHERE code IS NOT NULL;
CREATE INDEX promotions_active_period_idx ON public.promotions (starts_at, ends_at)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS tr_promotions_updated_at ON public.promotions;
CREATE TRIGGER tr_promotions_updated_at
  BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotions TO service_role;

ALTER TABLE public.bookings
  ADD COLUMN promotion_id uuid REFERENCES public.promotions(id) ON DELETE SET NULL,
  ADD COLUMN discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  ADD COLUMN total_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0);

UPDATE public.bookings b
SET total_amount = round(r.price * b.seats, 2)
FROM public.routes r
WHERE r.id = b.route_id;

CREATE OR REPLACE FUNCTION public.request_booking_with_promotion(
  p_actor uuid, p_route uuid, p_seats integer, p_promotion uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_booking public.bookings;
  v_route public.routes;
  v_promotion public.promotions;
  v_subtotal numeric(12,2);
  v_discount numeric(12,2) := 0;
BEGIN
  IF p_promotion IS NOT NULL THEN
    SELECT * INTO v_promotion FROM public.promotions
    WHERE id = p_promotion FOR SHARE;
    IF NOT FOUND OR NOT v_promotion.is_active
       OR v_promotion.starts_at > now() OR v_promotion.ends_at <= now() THEN
      RAISE EXCEPTION USING MESSAGE = '{"code":"PROMOTION_UNAVAILABLE","message":"La promoción ya no está disponible."}';
    END IF;
  END IF;

  v_result := public.request_booking(p_actor, p_route, p_seats);
  SELECT * INTO v_booking FROM public.bookings
  WHERE id = (v_result->>'id')::uuid FOR UPDATE;
  SELECT * INTO v_route FROM public.routes WHERE id = p_route;

  v_subtotal := round(v_route.price * v_booking.seats, 2);
  IF p_promotion IS NOT NULL THEN
    v_discount := CASE v_promotion.discount_type
      WHEN 'percentage' THEN round(v_subtotal * v_promotion.discount_value / 100, 2)
      ELSE least(v_promotion.discount_value, v_subtotal)
    END;
  END IF;

  UPDATE public.bookings
  SET promotion_id = p_promotion,
      discount_amount = v_discount,
      total_amount = v_subtotal - v_discount,
      updated_at = now()
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  RETURN v_result || jsonb_build_object(
    'promotionId', v_booking.promotion_id,
    'subtotal', v_subtotal,
    'discountAmount', v_booking.discount_amount,
    'totalAmount', v_booking.total_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_booking_with_promotion(uuid,uuid,integer,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_booking_with_promotion(uuid,uuid,integer,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_booking_total_to_trip_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT total_amount INTO NEW.amount
  FROM public.bookings
  WHERE id = NEW.booking_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_trip_payment_booking_total ON public.trip_payments;
CREATE TRIGGER tr_trip_payment_booking_total
  BEFORE INSERT ON public.trip_payments
  FOR EACH ROW EXECUTE FUNCTION public.apply_booking_total_to_trip_payment();

COMMIT;
