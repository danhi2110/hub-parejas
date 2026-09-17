-- ==============================================================================
-- HUB INTERACTIVO DE PAREJAS - ACTUALIZACIÓN FASE 2 / FASE 3 (ARCADE & PIZARRÓN)
-- Ejecuta este script en Supabase SQL Editor para soportar las nuevas funciones.
-- ==============================================================================

-- 1. TABLA: CANCIONES DEL PIZARRÓN (Spotify / YouTube embeds)
CREATE TABLE IF NOT EXISTS public.canciones_pizarron (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    autor_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    titulo VARCHAR(120) NOT NULL,
    url TEXT NOT NULL,
    dedicatoria TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canciones_espacio ON public.canciones_pizarron(espacio_id, creado_en DESC);

-- 2. TABLA: PUNTUACIONES GLOBALES DEL ARCADE
CREATE TABLE IF NOT EXISTS public.puntuaciones_arcade (
    espacio_id UUID PRIMARY KEY REFERENCES public.espacios(id) ON DELETE CASCADE,
    wins_p1 INT NOT NULL DEFAULT 0,
    wins_p2 INT NOT NULL DEFAULT 0,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. TABLA: TRIVIAS DE PAREJA PERSONALIZADAS
CREATE TABLE IF NOT EXISTS public.trivias_pareja (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    creado_por UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    pregunta TEXT NOT NULL,
    opciones JSONB NOT NULL, -- Array de 4 opciones ["Opción A", "Opción B", ...]
    indice_correcto INT NOT NULL DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trivias_espacio ON public.trivias_pareja(espacio_id);

-- 4. TABLA: DILEMAS Y RETOS CUSTOM (Esto o Aquello & Verdad o Reto)
CREATE TABLE IF NOT EXISTS public.dilemas_custom (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    opcion_a TEXT NOT NULL,
    opcion_b TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.retos_custom (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('VERDAD', 'RETO')),
    texto TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 5. PROCEDIMIENTOS RPC: MARCADOR GLOBAL ARCADE Y LIMPIEZA
-- ==============================================================================

-- RPC: Sumar victoria a un jugador en el marcador global
CREATE OR REPLACE FUNCTION public.sumar_victoria_arcade(p_jugador TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_espacio_id UUID := public.obtener_mi_espacio_id();
    v_res RECORD;
BEGIN
    IF v_espacio_id IS NULL THEN
        RAISE EXCEPTION 'Usuario sin espacio';
    END IF;

    -- Asegurar que existe registro de puntuación
    INSERT INTO public.puntuaciones_arcade (espacio_id, wins_p1, wins_p2)
    VALUES (v_espacio_id, 0, 0)
    ON CONFLICT (espacio_id) DO NOTHING;

    IF p_jugador = 'P1' THEN
        UPDATE public.puntuaciones_arcade
        SET wins_p1 = wins_p1 + 1, actualizado_en = now()
        WHERE espacio_id = v_espacio_id;
    ELSE
        UPDATE public.puntuaciones_arcade
        SET wins_p2 = wins_p2 + 1, actualizado_en = now()
        WHERE espacio_id = v_espacio_id;
    END IF;

    SELECT wins_p1, wins_p2 INTO v_res FROM public.puntuaciones_arcade WHERE espacio_id = v_espacio_id;
    RETURN jsonb_build_object('wins_p1', v_res.wins_p1, 'wins_p2', v_res.wins_p2);
END;
$$;

-- RPC: Reiniciar el marcador global
CREATE OR REPLACE FUNCTION public.reiniciar_marcador_arcade()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_espacio_id UUID := public.obtener_mi_espacio_id();
BEGIN
    IF v_espacio_id IS NULL THEN
        RAISE EXCEPTION 'Usuario sin espacio';
    END IF;

    INSERT INTO public.puntuaciones_arcade (espacio_id, wins_p1, wins_p2)
    VALUES (v_espacio_id, 0, 0)
    ON CONFLICT (espacio_id) DO UPDATE
    SET wins_p1 = 0, wins_p2 = 0, actualizado_en = now();
END;
$$;

-- RPC: Limpiar preguntas y dilemas temporales agregados
CREATE OR REPLACE FUNCTION public.limpiar_dinamicas_custom()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_espacio_id UUID := public.obtener_mi_espacio_id();
BEGIN
    IF v_espacio_id IS NOT NULL THEN
        DELETE FROM public.dilemas_custom WHERE espacio_id = v_espacio_id;
        DELETE FROM public.retos_custom WHERE espacio_id = v_espacio_id;
    END IF;
END $$;


-- ==============================================================================
-- 6. POLÍTICAS RLS (AISLAMIENTO POR PAREJA)
-- ==============================================================================
ALTER TABLE public.canciones_pizarron ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntuaciones_arcade ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trivias_pareja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dilemas_custom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retos_custom ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso a canciones de mi espacio" ON public.canciones_pizarron;
CREATE POLICY "Acceso a canciones de mi espacio" ON public.canciones_pizarron
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id());

DROP POLICY IF EXISTS "Acceso a puntuaciones de mi espacio" ON public.puntuaciones_arcade;
CREATE POLICY "Acceso a puntuaciones de mi espacio" ON public.puntuaciones_arcade
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id());

DROP POLICY IF EXISTS "Acceso a trivias de mi espacio" ON public.trivias_pareja;
CREATE POLICY "Acceso a trivias de mi espacio" ON public.trivias_pareja
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id());

DROP POLICY IF EXISTS "Acceso a dilemas de mi espacio" ON public.dilemas_custom;
CREATE POLICY "Acceso a dilemas de mi espacio" ON public.dilemas_custom
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id());

DROP POLICY IF EXISTS "Acceso a retos de mi espacio" ON public.retos_custom;
CREATE POLICY "Acceso a retos de mi espacio" ON public.retos_custom
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id());


-- ==============================================================================
-- 7. SUPABASE REALTIME (IDEMPOTENTE)
-- ==============================================================================
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.canciones_pizarron;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.puntuaciones_arcade;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.trivias_pareja;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.dilemas_custom;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.retos_custom;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;
