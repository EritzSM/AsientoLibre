-- HU-14: remove the unused promotion conditions field.
BEGIN;

ALTER TABLE public.promotions DROP COLUMN IF EXISTS conditions;

COMMIT;
