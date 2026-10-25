-- Expose only the anonymous aggregate of ratings received by a profile.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_profile_rating_summary(p_profile uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'average', CASE WHEN count(*) = 0 THEN NULL ELSE round(avg(score)::numeric, 2) END,
    'count', count(*)
  )
  FROM public.route_ratings
  WHERE rated_id = p_profile;
$$;

REVOKE ALL ON FUNCTION public.get_profile_rating_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_rating_summary(uuid) TO service_role;

COMMIT;
