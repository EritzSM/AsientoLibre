-- Verificación y cambio de correo. Idempotente para proyectos existentes.
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT false NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS activation_token text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_change_code text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_change_expires_at timestamptz;

DROP INDEX IF EXISTS public.idx_profiles_activation_token;
CREATE UNIQUE INDEX idx_profiles_activation_token ON public.profiles(activation_token)
WHERE activation_token IS NOT NULL;

-- El backend con secret/service-role es el único escritor de perfiles.
DROP POLICY IF EXISTS "Permitir inserción de perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Permitir actualización de perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Permitir inserción de propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Permitir actualizar propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Permitir inserción de vehículos" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir actualización de vehículos" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir eliminación de vehículos" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir insertar propio vehículo" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir actualizar propio vehículo" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir eliminar propio vehículo" ON public.vehicles;
REVOKE INSERT, UPDATE, DELETE ON public.profiles, public.vehicles FROM PUBLIC, anon, authenticated;

COMMIT;
