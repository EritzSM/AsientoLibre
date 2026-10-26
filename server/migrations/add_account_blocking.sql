-- ============================================================
-- Asiento Libre — Migración: Bloqueo de cuentas y solicitudes de apelación
-- Ejecuta este script en el SQL Editor de Supabase
-- ============================================================

-- 1. Agregar columnas de bloqueo a la tabla profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_blocked   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS block_reason TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS blocked_at   TIMESTAMPTZ DEFAULT NULL;

-- 2. Crear tabla de apelaciones / solicitudes de desbloqueo
CREATE TABLE IF NOT EXISTS public.account_appeals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  message     TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note  TEXT        DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  reviewed_by UUID        REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_account_appeals_user_id ON public.account_appeals(user_id);
CREATE INDEX IF NOT EXISTS idx_account_appeals_status  ON public.account_appeals(status);
CREATE INDEX IF NOT EXISTS idx_profiles_is_blocked     ON public.profiles(is_blocked);

-- 3. Habilitar RLS en account_appeals
ALTER TABLE public.account_appeals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_anon_or_auth_insert_appeals" ON public.account_appeals;
CREATE POLICY "allow_anon_or_auth_insert_appeals"
  ON public.account_appeals FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "allow_users_select_own_appeals" ON public.account_appeals;
CREATE POLICY "allow_users_select_own_appeals"
  ON public.account_appeals FOR SELECT
  USING (auth.uid() = user_id);
