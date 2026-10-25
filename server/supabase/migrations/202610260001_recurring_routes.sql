-- HU-7: recurring route series and generated route instances.
BEGIN;

CREATE TABLE IF NOT EXISTS public.route_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  origin text NOT NULL,
  destination text NOT NULL,
  meeting_point text NOT NULL,
  weekdays smallint[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7),
  departure_time time NOT NULL,
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 8),
  price numeric(12,2) NOT NULL DEFAULT 0,
  note text,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on = starts_on + 27),
  CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);

ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.route_series(id) ON DELETE SET NULL;
ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS occurrence_date date;
CREATE UNIQUE INDEX IF NOT EXISTS routes_series_occurrence_unique ON public.routes(series_id, occurrence_date) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS route_series_driver_idx ON public.route_series(driver_id, starts_on, ends_on);

ALTER TABLE public.route_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_series FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.route_series FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_series TO service_role;

CREATE OR REPLACE FUNCTION public.create_recurring_route_series(
  p_actor uuid, p_origin text, p_destination text, p_meeting_point text,
  p_start_date date, p_time time, p_weekdays smallint[], p_seats integer,
  p_price numeric DEFAULT 0, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_series uuid; v_day date; v_doc jsonb; v_route uuid; v_count integer := 0; v_days smallint[];
BEGIN
  IF p_start_date IS NULL OR p_start_date < (now() AT TIME ZONE 'America/Bogota')::date THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"La fecha inicial debe ser hoy o una fecha futura."}';
  END IF;
  SELECT array_agg(DISTINCT d ORDER BY d) INTO v_days FROM unnest(p_weekdays) d WHERE d BETWEEN 0 AND 6;
  IF cardinality(v_days) IS NULL OR cardinality(v_days) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"Selecciona al menos un día de la semana."}';
  END IF;
  INSERT INTO public.route_series(driver_id,origin,destination,meeting_point,weekdays,departure_time,seats,price,note,starts_on,ends_on)
  VALUES(p_actor,btrim(p_origin),btrim(p_destination),btrim(p_meeting_point),v_days,p_time,p_seats,p_price,nullif(btrim(p_note),''),p_start_date,p_start_date+27)
  RETURNING id INTO v_series;
  FOR v_day IN SELECT generate_series(p_start_date,p_start_date+27,interval '1 day')::date LOOP
    IF extract(dow FROM v_day)::smallint = ANY(v_days)
       AND ((v_day + p_time) AT TIME ZONE 'America/Bogota') > now() THEN
      v_doc := public.create_route_v2(p_actor,p_origin,p_destination,(v_day+p_time) AT TIME ZONE 'America/Bogota',p_seats,p_price,p_note,p_meeting_point);
      v_route := (v_doc->>'id')::uuid;
      UPDATE public.routes SET series_id=v_series, occurrence_date=v_day WHERE id=v_route;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  IF v_count = 0 THEN RAISE EXCEPTION USING MESSAGE = '{"code":"VALIDATION_ERROR","message":"La regla no genera viajes futuros dentro de las próximas cuatro semanas."}'; END IF;
  RETURN jsonb_build_object('id',v_series,'generatedCount',v_count,'startsOn',p_start_date,'endsOn',p_start_date+27);
END; $$;

CREATE OR REPLACE FUNCTION public.update_recurring_route_series(p_actor uuid,p_series uuid,p_time time)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_series public.route_series; v_updated integer; v_skipped integer;
BEGIN
  SELECT * INTO v_series FROM public.route_series WHERE id=p_series FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La serie recurrente no existe."}'; END IF;
  IF v_series.driver_id <> p_actor THEN RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el conductor propietario puede editar la serie."}'; END IF;
  UPDATE public.routes r SET departure_at=(r.occurrence_date+p_time) AT TIME ZONE 'America/Bogota',updated_at=now()
  WHERE r.series_id=p_series AND r.status='published' AND r.departure_at>now()
    AND NOT EXISTS(SELECT 1 FROM public.bookings b WHERE b.route_id=r.id AND b.status IN ('pending','confirmed'));
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  SELECT count(*) INTO v_skipped FROM public.routes r WHERE r.series_id=p_series AND r.status='published' AND r.departure_at>now()
    AND EXISTS(SELECT 1 FROM public.bookings b WHERE b.route_id=r.id AND b.status IN ('pending','confirmed'));
  UPDATE public.route_series SET departure_time=p_time,updated_at=now() WHERE id=p_series;
  RETURN jsonb_build_object('id',p_series,'updatedCount',v_updated,'skippedReservedCount',v_skipped,'time',to_char(p_time,'HH24:MI'));
END; $$;

REVOKE ALL ON FUNCTION public.create_recurring_route_series(uuid,text,text,text,date,time,smallint[],integer,numeric,text), public.update_recurring_route_series(uuid,uuid,time) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_recurring_route_series(uuid,text,text,text,date,time,smallint[],integer,numeric,text), public.update_recurring_route_series(uuid,uuid,time) TO service_role;
COMMIT;
