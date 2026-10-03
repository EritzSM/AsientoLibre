-- ============================================================
-- Asiento Libre — Tabla: conductor_documents (Idempotente)
-- Ejecuta este script en el SQL Editor de Supabase
-- ============================================================

-- ============================================================
-- 0. Permitir el rol 'admin' en la tabla profiles
-- ============================================================
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('pasajero', 'conductor', 'admin'));

-- 1. Crear tipos enumerados de forma segura (ignora si ya existen)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_type') THEN
    CREATE TYPE document_type AS ENUM ('licencia', 'soat', 'cedula', 'foto_vehiculo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_status') THEN
    CREATE TYPE document_status AS ENUM ('pendiente', 'aprobado', 'rechazado');
  END IF;
END $$;

-- 2. Tabla principal de documentos de conductores
CREATE TABLE IF NOT EXISTS public.conductor_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conductor_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type    document_type NOT NULL,
  file_url         TEXT NOT NULL,
  file_name        TEXT,
  status           document_status NOT NULL DEFAULT 'pendiente',
  rejection_reason TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- 3. Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_conductor_documents_conductor_id ON public.conductor_documents(conductor_id);
CREATE INDEX IF NOT EXISTS idx_conductor_documents_status ON public.conductor_documents(status);

-- 4. RLS y Políticas de acceso
ALTER TABLE public.conductor_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conductors_read_own_documents" ON public.conductor_documents;
CREATE POLICY "conductors_read_own_documents"
  ON public.conductor_documents FOR SELECT
  USING (auth.uid() = conductor_id);

DROP POLICY IF EXISTS "conductors_insert_own_documents" ON public.conductor_documents;
CREATE POLICY "conductors_insert_own_documents"
  ON public.conductor_documents FOR INSERT
  WITH CHECK (auth.uid() = conductor_id);

DROP POLICY IF EXISTS "conductors_update_own_documents" ON public.conductor_documents;
CREATE POLICY "conductors_update_own_documents"
  ON public.conductor_documents FOR UPDATE
  USING (auth.uid() = conductor_id)
  WITH CHECK (auth.uid() = conductor_id);

DROP POLICY IF EXISTS "conductors_delete_own_documents" ON public.conductor_documents;
CREATE POLICY "conductors_delete_own_documents"
  ON public.conductor_documents FOR DELETE
  USING (auth.uid() = conductor_id);

-- Comentarios de documentación
COMMENT ON TABLE public.conductor_documents IS 'Documentos subidos por conductores para verificación por parte del admin.';
COMMENT ON COLUMN public.conductor_documents.document_type IS 'Tipo de documento: licencia, soat, cedula o foto_vehiculo.';
COMMENT ON COLUMN public.conductor_documents.status IS 'Estado de revisión: pendiente, aprobado, rechazado.';
COMMENT ON COLUMN public.conductor_documents.rejection_reason IS 'Motivo del rechazo, solo aplica cuando status = rechazado.';
COMMENT ON COLUMN public.conductor_documents.reviewed_by IS 'ID del admin que revisó el documento.';

