-- ==============================================================================
-- HUB INTERACTIVO DE PAREJAS - SCRIPT DE LIMPIEZA TOTAL (RESET DE USUARIOS)
-- Ejecuta este script en Supabase SQL Editor si deseas borrar todos los usuarios
-- y datos de prueba para comenzar 100% desde cero.
-- ==============================================================================

-- 1. Desactivar temporalmente restricciones para borrado limpio
DO $$
BEGIN
    -- Vaciar todas las tablas del esquema público
    EXECUTE 'TRUNCATE TABLE 
        public.reacciones_notas,
        public.notas,
        public.recuerdos,
        public.estados_animo,
        public.bucket_list,
        public.fechas_especiales,
        public.usuarios,
        public.espacios
    CASCADE;';

    -- Si existen las tablas v3, vaciarlas también
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'canciones_pizarron') THEN
        EXECUTE 'TRUNCATE TABLE public.canciones_pizarron, public.trivias_pareja, public.dilemas_custom, public.retos_custom, public.puntuaciones_arcade CASCADE;';
    END IF;

    -- Borrar todos los usuarios registrados en auth.users
    DELETE FROM auth.users;

    RAISE NOTICE 'Base de datos reiniciada con éxito. Ya puedes registrar usuarios nuevos.';
END $$;
