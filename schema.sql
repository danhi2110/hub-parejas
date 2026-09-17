-- ==============================================================================
-- HUB INTERACTIVO DE PAREJAS - ESQUEMA DE BASE DE DATOS SUPABASE (PostgreSQL 15+)
-- ==============================================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABLA: ESPACIOS DE PAREJA
-- Almacena el contenedor compartido por exactamente 2 usuarios.
CREATE TABLE IF NOT EXISTS public.espacios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_invitacion VARCHAR(6) UNIQUE, -- Código de 6 caracteres alfanuméricos en mayúsculas
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente_pareja' 
        CHECK (estado IN ('pendiente_pareja', 'activo', 'archivado')),
    fecha_aniversario TIMESTAMPTZ, -- Fecha de inicio para el contador en tiempo real
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para búsqueda rápida del código de invitación
CREATE INDEX IF NOT EXISTS idx_espacios_codigo ON public.espacios (codigo_invitacion);

-- 3. TABLA: USUARIOS (Perfiles públicos enlazados a auth.users)
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(30) UNIQUE NOT NULL,
    alias VARCHAR(50) NOT NULL,
    espacio_id UUID REFERENCES public.espacios(id) ON DELETE SET NULL,
    avatar_url TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para consultas frecuentes por espacio
CREATE INDEX IF NOT EXISTS idx_usuarios_espacio ON public.usuarios (espacio_id);

-- 4. TABLA: NOTAS DEL MURO
CREATE TABLE IF NOT EXISTS public.notas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    autor_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    contenido TEXT NOT NULL CHECK (char_length(trim(contenido)) > 0 AND char_length(contenido) <= 1000),
    color_hex VARCHAR(7) NOT NULL DEFAULT '#fef3c7', -- Color pastel del post-it
    fijada BOOLEAN NOT NULL DEFAULT false,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notas_espacio ON public.notas (espacio_id, creado_en DESC);

-- 5. TABLA: RECUERDOS (Línea de tiempo / Galería)
CREATE TABLE IF NOT EXISTS public.recuerdos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    autor_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    titulo VARCHAR(100) NOT NULL,
    descripcion TEXT,
    fecha_evento DATE NOT NULL,
    imagen_url TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recuerdos_espacio ON public.recuerdos (espacio_id, fecha_evento DESC);


-- ==============================================================================
-- 6. FUNCIONES AUXILIARES Y PROCEDIMIENTOS RPC
-- ==============================================================================

-- Función para obtener el espacio_id del usuario actual autenticado (Helper RLS)
CREATE OR REPLACE FUNCTION public.obtener_mi_espacio_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT espacio_id FROM public.usuarios WHERE id = auth.uid();
$$;

-- Función interna: Genera un código de 6 caracteres aleatorio (Base32 sin 0, O, 1, I)
CREATE OR REPLACE FUNCTION public.generar_codigo_invitacion()
RETURNS VARCHAR(6)
LANGUAGE plpgsql
AS $$
DECLARE
    caracteres TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    codigo VARCHAR(6) := '';
    i INT;
    existe BOOLEAN;
BEGIN
    LOOP
        codigo := '';
        FOR i IN 1..6 LOOP
            codigo := codigo || substr(caracteres, floor(random() * length(caracteres) + 1)::int, 1);
        END LOOP;
        
        -- Verificar que no colisione con otro espacio pendiente
        SELECT EXISTS(SELECT 1 FROM public.espacios WHERE codigo_invitacion = codigo) INTO existe;
        IF NOT existe THEN
            RETURN codigo;
        END IF;
    END LOOP;
END;
$$;

-- RPC: Crear nuevo Espacio de Pareja (Usuario 1)
CREATE OR REPLACE FUNCTION public.crear_espacio_pareja(
    p_alias TEXT,
    p_fecha_aniversario TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_nuevo_espacio_id UUID;
    v_codigo VARCHAR(6);
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    -- Verificar si el usuario ya tiene un espacio asignado
    IF EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_user_id AND espacio_id IS NOT NULL) THEN
        RAISE EXCEPTION 'El usuario ya pertenece a un espacio activo';
    END IF;

    v_codigo := public.generar_codigo_invitacion();

    -- Insertar el nuevo espacio
    INSERT INTO public.espacios (codigo_invitacion, estado, fecha_aniversario)
    VALUES (v_codigo, 'pendiente_pareja', p_fecha_aniversario)
    RETURNING id INTO v_nuevo_espacio_id;

    -- Vincular al usuario creador
    UPDATE public.usuarios
    SET espacio_id = v_nuevo_espacio_id,
        alias = COALESCE(NULLIF(trim(p_alias), ''), alias)
    WHERE id = v_user_id;

    RETURN jsonb_build_object(
        'espacio_id', v_nuevo_espacio_id,
        'codigo_invitacion', v_codigo,
        'estado', 'pendiente_pareja'
    );
END;
$$;

-- RPC: Unirse a un Espacio con Código de 6 caracteres (Usuario 2 - Control Estricto de 2 Usuarios)
CREATE OR REPLACE FUNCTION public.unirse_a_espacio(
    p_alias TEXT,
    p_codigo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_codigo_normalizado VARCHAR(6);
    v_espacio RECORD;
    v_conteo_usuarios INT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    v_codigo_normalizado := upper(trim(p_codigo));

    IF length(v_codigo_normalizado) != 6 THEN
        RAISE EXCEPTION 'El código debe tener exactamente 6 caracteres alfanuméricos';
    END IF;

    -- Bloqueo pesimista (FOR UPDATE) para evitar condiciones de carrera simultáneas
    SELECT id, estado INTO v_espacio
    FROM public.espacios
    WHERE codigo_invitacion = v_codigo_normalizado
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Código de invitación inválido o no encontrado';
    END IF;

    IF v_espacio.estado != 'pendiente_pareja' THEN
        RAISE EXCEPTION 'Este espacio ya no está disponible para nuevas conexiones';
    END IF;

    -- Conteo estricto de miembros actuales
    SELECT count(*) INTO v_conteo_usuarios
    FROM public.usuarios
    WHERE espacio_id = v_espacio.id;

    IF v_conteo_usuarios >= 2 THEN
        RAISE EXCEPTION 'El espacio ya alcanzó el límite estricto de 2 integrantes';
    END IF;

    -- Vincular al segundo usuario
    UPDATE public.usuarios
    SET espacio_id = v_espacio.id,
        alias = COALESCE(NULLIF(trim(p_alias), ''), alias)
    WHERE id = v_user_id;

    -- Activar el espacio y anular el código para prevenir reúsos
    UPDATE public.espacios
    SET estado = 'activo',
        codigo_invitacion = NULL
    WHERE id = v_espacio.id;

    RETURN jsonb_build_object(
        'success', true,
        'espacio_id', v_espacio.id,
        'estado', 'activo'
    );
END;
$$;

-- RPC: Actualizar fecha de aniversario
CREATE OR REPLACE FUNCTION public.actualizar_aniversario(p_fecha TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_espacio_id UUID := public.obtener_mi_espacio_id();
BEGIN
    IF v_espacio_id IS NULL THEN
        RAISE EXCEPTION 'El usuario no tiene un espacio asignado';
    END IF;

    UPDATE public.espacios
    SET fecha_aniversario = p_fecha
    WHERE id = v_espacio_id;
END;
$$;


-- ==============================================================================
-- 7. TRIGGER: CREAR PERFIL EN public.usuarios AL REGISTRARSE EN auth.users
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_username TEXT;
    v_alias TEXT;
BEGIN
    -- Extrae el username metadato o deduce del pseudo-email
    v_username := COALESCE(
        new.raw_user_meta_data->>'username',
        split_part(new.email, '@', 1)
    );
    v_alias := COALESCE(
        new.raw_user_meta_data->>'alias',
        v_username
    );

    INSERT INTO public.usuarios (id, username, alias)
    VALUES (new.id, v_username, v_alias)
    ON CONFLICT (id) DO UPDATE
    SET username = EXCLUDED.username,
        alias = EXCLUDED.alias;

    RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ==============================================================================
-- 8. POLÍTICAS DE SEGURIDAD (ROW LEVEL SECURITY - RLS)
-- ==============================================================================
ALTER TABLE public.espacios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recuerdos ENABLE ROW LEVEL SECURITY;

-- Políticas para: espacios
DROP POLICY IF EXISTS "Ver mi propio espacio" ON public.espacios;
CREATE POLICY "Ver mi propio espacio" ON public.espacios
    FOR SELECT TO authenticated
    USING (id = public.obtener_mi_espacio_id());

DROP POLICY IF EXISTS "Actualizar mi propio espacio" ON public.espacios;
CREATE POLICY "Actualizar mi propio espacio" ON public.espacios
    FOR UPDATE TO authenticated
    USING (id = public.obtener_mi_espacio_id())
    WITH CHECK (id = public.obtener_mi_espacio_id());

-- Políticas para: usuarios
DROP POLICY IF EXISTS "Ver miembros de mi espacio o mi perfil" ON public.usuarios;
CREATE POLICY "Ver miembros de mi espacio o mi perfil" ON public.usuarios
    FOR SELECT TO authenticated
    USING (
        id = auth.uid() 
        OR (espacio_id IS NOT NULL AND espacio_id = public.obtener_mi_espacio_id())
    );

DROP POLICY IF EXISTS "Actualizar mi propio perfil" ON public.usuarios;
CREATE POLICY "Actualizar mi propio perfil" ON public.usuarios
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Políticas para: notas (Aislamiento por pareja)
DROP POLICY IF EXISTS "Acceso a notas de mi espacio" ON public.notas;
CREATE POLICY "Acceso a notas de mi espacio" ON public.notas
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id() AND autor_id = auth.uid());

-- Políticas para: recuerdos (Aislamiento por pareja)
DROP POLICY IF EXISTS "Acceso a recuerdos de mi espacio" ON public.recuerdos;
CREATE POLICY "Acceso a recuerdos de mi espacio" ON public.recuerdos
    FOR ALL TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id())
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id() AND autor_id = auth.uid());


-- ==============================================================================
-- 9. HABILITAR SUPABASE REALTIME (Idempotente)
-- ==============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.espacios;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notas;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.recuerdos;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

