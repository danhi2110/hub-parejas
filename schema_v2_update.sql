-- ==============================================================================
-- HUB INTERACTIVO DE PAREJAS - ACTUALIZACIÓN FASE 1 (DOCUMENTO MAESTRO v2)
-- ==============================================================================

-- 1. TABLA: ESTADOS DE ÁNIMO DIARIOS
CREATE TABLE IF NOT EXISTS public.estados_animo (
    usuario_id UUID PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL DEFAULT '😊',
    nota_corta VARCHAR(150),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estados_espacio ON public.estados_animo(espacio_id);

-- 2. TABLA: BUCKET LIST (SUEÑOS Y PLANES COMPARTIDOS)
CREATE TABLE IF NOT EXISTS public.bucket_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    creado_por UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    titulo VARCHAR(150) NOT NULL,
    categoria VARCHAR(50) NOT NULL DEFAULT 'citas' 
        CHECK (categoria IN ('viajes', 'comida', 'peliculas', 'citas', 'metas', 'random')),
    completado BOOLEAN NOT NULL DEFAULT false,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bucket_espacio ON public.bucket_list(espacio_id, creado_en DESC);

-- 3. TABLA: REACCIONES A LAS NOTAS
CREATE TABLE IF NOT EXISTS public.reacciones_notas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nota_id UUID NOT NULL REFERENCES public.notas(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nota_id, usuario_id) -- Un emoji por usuario por nota
);

CREATE INDEX IF NOT EXISTS idx_reacciones_nota ON public.reacciones_notas(nota_id);

-- 4. TABLA: FECHAS ESPECIALES Y RECORDATORIOS
CREATE TABLE IF NOT EXISTS public.fechas_especiales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    titulo VARCHAR(100) NOT NULL,
    fecha_evento DATE NOT NULL,
    categoria VARCHAR(50) NOT NULL DEFAULT 'aniversario',
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fechas_espacio ON public.fechas_especiales(espacio_id, fecha_evento ASC);


-- ==============================================================================
-- 5. HABILITAR ROW LEVEL SECURITY (RLS)
-- ==============================================================================
ALTER TABLE public.estados_animo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reacciones_notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechas_especiales ENABLE ROW LEVEL SECURITY;

-- Políticas para: estados_animo
DROP POLICY IF EXISTS "Acceso a estados de animo del espacio" ON public.estados_animo;
CREATE POLICY "Acceso a estados de animo del espacio" ON public.estados_animo
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id() AND usuario_id = auth.uid());

-- Políticas para: bucket_list
DROP POLICY IF EXISTS "Acceso a bucket list del espacio" ON public.bucket_list;
CREATE POLICY "Acceso a bucket list del espacio" ON public.bucket_list
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id());

-- Políticas para: reacciones_notas
DROP POLICY IF EXISTS "Acceso a reacciones de mi espacio" ON public.reacciones_notas;
CREATE POLICY "Acceso a reacciones de mi espacio" ON public.reacciones_notas
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.notas n 
            WHERE n.id = nota_id AND n.espacio_id = public.obtener_mi_espacio_id()
        )
    )
    WITH CHECK (usuario_id = auth.uid());

-- Políticas para: fechas_especiales
DROP POLICY IF EXISTS "Acceso a fechas de mi espacio" ON public.fechas_especiales;
CREATE POLICY "Acceso a fechas de mi espacio" ON public.fechas_especiales
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id());


-- ==============================================================================
-- 6. HABILITAR SUPABASE REALTIME (IDEMPOTENTE)
-- ==============================================================================
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.estados_animo;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.bucket_list;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.reacciones_notas;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.fechas_especiales;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;
