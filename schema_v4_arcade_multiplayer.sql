-- ==============================================================================
-- HUB INTERACTIVO DE PAREJAS - FASE 4: ARCADE MULTIJUGADOR 1v1 EN TIEMPO REAL
-- Minijuegos online sincronizados vía Supabase Realtime:
--   * Piedra, Papel o Tijera (rps)       -> selección ciega simultánea
--   * Ajedrez (chess)                    -> sincronización por turnos
--   * Damas (checkers)                   -> sincronización por turnos
--
-- Ejecuta este script en Supabase SQL Editor (es idempotente, se puede
-- re-ejecutar sin romper nada).
-- ==============================================================================

-- ==============================================================================
-- 1. TIPOS ENUM
-- ==============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'arcade_game_type') THEN
        CREATE TYPE public.arcade_game_type AS ENUM ('rps', 'chess', 'checkers');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'arcade_match_status') THEN
        CREATE TYPE public.arcade_match_status AS ENUM ('waiting', 'in_progress', 'finished', 'abandoned');
    END IF;
END $$;

-- ==============================================================================
-- 2. TABLA: arcade_matches (UNA FILA POR SESIÓN 1v1, se reutiliza por rondas)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.arcade_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    game_type public.arcade_game_type NOT NULL,
    player_1_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    player_2_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    current_turn UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    board_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    scores JSONB NOT NULL DEFAULT '{"p1":0,"p2":0}'::jsonb,
    status public.arcade_match_status NOT NULL DEFAULT 'waiting',
    winner_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    rev INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice por espacio (consultas habituales + matchmaking)
CREATE INDEX IF NOT EXISTS idx_arcade_matches_espacio
    ON public.arcade_matches (espacio_id, updated_at DESC);

-- Índice parcial solo de partidas vivas (rapidez del matchmaking)
CREATE INDEX IF NOT EXISTS idx_arcade_matches_activas
    ON public.arcade_matches (espacio_id)
    WHERE status IN ('waiting', 'in_progress');

-- ==============================================================================
-- 3. TRIGGER: mantener updated_at automáticamente
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_arcade_matches_updated_at ON public.arcade_matches;
CREATE TRIGGER trg_arcade_matches_updated_at
    BEFORE UPDATE ON public.arcade_matches
    FOR EACH ROW EXECUTE FUNCTION public.arcade_set_updated_at();

-- ==============================================================================
-- 4. HELPER: estado inicial de tablero por tipo de juego
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_initial_board(p_game_type public.arcade_game_type)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows JSONB := '[]'::jsonb;
    v_row JSONB;
    v_cell TEXT;
    r INT;
    c INT;
BEGIN
    -- Piedra, Papel o Tijera: movimientos ESCONDIDOS hasta que ambos elijan
    IF p_game_type = 'rps' THEN
        RETURN jsonb_build_object(
            'p1', NULL,
            'p2', NULL,
            'last_result', NULL
        );
    END IF;

    -- Ajedrez: matriz 8x8 + quien mueve (Blancas = player_1)
    IF p_game_type = 'chess' THEN
        RETURN jsonb_build_object(
            'board', jsonb_build_array(
                jsonb_build_array('bR','bN','bB','bQ','bK','bB','bN','bR'),
                jsonb_build_array('bP','bP','bP','bP','bP','bP','bP','bP'),
                jsonb_build_array(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
                jsonb_build_array(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
                jsonb_build_array(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
                jsonb_build_array(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
                jsonb_build_array('wP','wP','wP','wP','wP','wP','wP','wP'),
                jsonb_build_array('wR','wN','wB','wQ','wK','wB','wN','wR')
            ),
            'turn_color', 'white',
            'fen', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
        );
    END IF;

    -- Damas: matriz 8x8 (filas 0-2 = b/negras, filas 5-7 = r/rojas sobre casillas oscuras)
    FOR r IN 0..7 LOOP
        v_row := '[]'::jsonb;
        FOR c IN 0..7 LOOP
            IF (r + c) % 2 = 1 THEN
                IF r < 3 THEN
                    v_cell := 'b';
                ELSIF r > 4 THEN
                    v_cell := 'r';
                ELSE
                    v_cell := NULL;
                END IF;
            ELSE
                v_cell := NULL;
            END IF;
            v_row := v_row || jsonb_build_array(v_cell);
        END LOOP;
        v_rows := v_rows || jsonb_build_array(v_row);
    END LOOP;

    RETURN jsonb_build_object(
        'board', v_rows,
        'turn_color', 'red'
    );
END;
$$;

-- ==============================================================================
-- 5. HELPER: serializar una fila de arcade_matches a JSON (para RPCs)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_match_to_json(m public.arcade_matches)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'match_id', m.id,
        'espacio_id', m.espacio_id,
        'game_type', m.game_type,
        'player_1_id', m.player_1_id,
        'player_2_id', m.player_2_id,
        'current_turn', m.current_turn,
        'board_state', m.board_state,
        'scores', m.scores,
        'status', m.status,
        'winner_id', m.winner_id,
        'rev', m.rev,
        'created_at', m.created_at,
        'updated_at', m.updated_at
    );
$$;

-- ==============================================================================
-- 6. HELPER: ganador de Piedra, Papel o Tijera
-- Devuelve 'draw' | 'p1' | 'p2' (los roles de la partida)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_rps_winner(a TEXT, b TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN a = b THEN 'draw'
        WHEN (a = 'piedra' AND b = 'tijera')
          OR (a = 'papel' AND b = 'piedra')
          OR (a = 'tijera' AND b = 'papel') THEN 'p1'
        ELSE 'p2'
    END;
$$;

-- ==============================================================================
-- 7. RPC: MATCHMAKING / RECONEXIÓN (crear, unirse o reutilizar la sesión)
-- ------------------------------------------------------------------------------
-- Reglas:
--   1. Si el usuario ya tiene una partida (waiting/in_progress/finished) de este
--      tipo -> se la devolvemos (mantiene UN SOLO match_id por sesión).
--   2. Si no, intenta unirse a una sala 'waiting' creada por SU PAREJA.
--   3. Si no hay ninguna, crea una nueva como player_1 (sala en espera).
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_find_or_create(p_game_type public.arcade_game_type)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_espacio_id UUID := public.obtener_mi_espacio_id();
    v_match public.arcade_matches%ROWTYPE;
BEGIN
    IF v_espacio_id IS NULL THEN
        RAISE EXCEPTION 'Usuario sin espacio';
    END IF;

    -- 1) Reutilizar sesión existente del usuario para este juego
    SELECT * INTO v_match
    FROM public.arcade_matches
    WHERE espacio_id = v_espacio_id
      AND game_type = p_game_type
      AND status IN ('waiting', 'in_progress', 'finished')
      AND (player_1_id = v_user_id OR player_2_id = v_user_id)
    ORDER BY updated_at DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        -- 2) Unirse a la sala en espera creada por la pareja
        SELECT * INTO v_match
        FROM public.arcade_matches
        WHERE espacio_id = v_espacio_id
          AND game_type = p_game_type
          AND status = 'waiting'
          AND player_1_id <> v_user_id
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;

        IF FOUND THEN
            UPDATE public.arcade_matches
            SET player_2_id = v_user_id,
                status = 'in_progress',
                current_turn = v_match.player_1_id
            WHERE id = v_match.id
            RETURNING * INTO v_match;
        ELSE
            -- 3) Crear una sala nueva como player_1
            INSERT INTO public.arcade_matches (espacio_id, game_type, player_1_id, current_turn, board_state)
            VALUES (v_espacio_id,
                    p_game_type,
                    v_user_id,
                    NULL,
                    public.arcade_initial_board(p_game_type))
            RETURNING * INTO v_match;
        END IF;
    END IF;

    RETURN public.arcade_match_to_json(v_match);
END;
$$;

-- ==============================================================================
-- 8. RPC: PIEDRA, PAPEL O TIJERA - elegir jugada (oculta hasta que ambos elijan)
-- ------------------------------------------------------------------------------
-- La elección se guarda en board_state.p1 / board_state.p2.
-- Solo cuando AMBAS secciones están llenas se resuelve la ronda:
--   * actualiza scores de la sesión (+1 al ganador)
--   * alimenta el marcador global (puntuaciones_arcade)
--   * guarda 'last_result' (revelación) y limpia las elecciones ocultas
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_rps_choose(p_match_id UUID, p_choice TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_match public.arcade_matches%ROWTYPE;
    v_board JSONB;
    v_scores JSONB;
    v_p1_score INT;
    v_p2_score INT;
    v_winner_role TEXT;
    v_last_result JSONB;
BEGIN
    IF p_choice NOT IN ('piedra', 'papel', 'tijera') THEN
        RAISE EXCEPTION 'Jugada inválida';
    END IF;

    SELECT * INTO v_match
    FROM public.arcade_matches
    WHERE id = p_match_id
      AND (player_1_id = v_user_id OR player_2_id = v_user_id)
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No formas parte de esta partida';
    END IF;

    IF v_match.status <> 'in_progress' THEN
        RAISE EXCEPTION 'La partida no está activa';
    END IF;

    v_board := v_match.board_state;

    -- Nueva ronda: si nadie ha elegido aún, limpiar la revelación de la ronda anterior
    IF jsonb_typeof(v_board->'p1') = 'null' AND jsonb_typeof(v_board->'p2') = 'null' THEN
        v_board := jsonb_set(v_board, '{last_result}', 'null'::jsonb);
    END IF;

    -- Guardar mi elección en el slot correspondiente (si aún está vacío)
    IF v_user_id = v_match.player_1_id THEN
        IF jsonb_typeof(v_board->'p1') <> 'null' THEN
            RAISE EXCEPTION 'Ya has elegido jugada en esta ronda';
        END IF;
        v_board := jsonb_set(v_board, '{p1}', to_jsonb(p_choice));
    ELSE
        IF jsonb_typeof(v_board->'p2') <> 'null' THEN
            RAISE EXCEPTION 'Ya has elegido jugada en esta ronda';
        END IF;
        v_board := jsonb_set(v_board, '{p2}', to_jsonb(p_choice));
    END IF;

    -- ¿Ambos eligieron? -> resolver la ronda y revelar
    IF jsonb_typeof(v_board->'p1') <> 'null' AND jsonb_typeof(v_board->'p2') <> 'null' THEN
        v_winner_role := public.arcade_rps_winner(v_board->>'p1', v_board->>'p2');

        v_p1_score := COALESCE((v_match.scores->>'p1')::int, 0);
        v_p2_score := COALESCE((v_match.scores->>'p2')::int, 0);

        IF v_winner_role = 'p1' THEN
            v_p1_score := v_p1_score + 1;
            PERFORM public.sumar_victoria_arcade('P1');
        ELSIF v_winner_role = 'p2' THEN
            v_p2_score := v_p2_score + 1;
            PERFORM public.sumar_victoria_arcade('P2');
        END IF;

        v_scores := jsonb_build_object('p1', v_p1_score, 'p2', v_p2_score);

        -- Revelación simultánea: guardamos la elección DE AMBOS y limpiamos la
        -- ronda para que la siguiente empiece en blanco.
        v_last_result := jsonb_build_object(
            'p1_choice', v_board->>'p1',
            'p2_choice', v_board->>'p2',
            'winner', v_winner_role
        );
        v_board := jsonb_build_object(
            'p1', NULL,
            'p2', NULL,
            'last_result', v_last_result
        );
    END IF;

    UPDATE public.arcade_matches
    SET board_state = v_board,
        scores = COALESCE(v_scores, v_match.scores),
        rev = v_match.rev + 1
    WHERE id = p_match_id
    RETURNING * INTO v_match;

    RETURN public.arcade_match_to_json(v_match);
END;
$$;

-- ==============================================================================
-- 9. RPC: AJEDREZ / DAMAS - registrar jugada por turnos
-- ------------------------------------------------------------------------------
-- Autoritativo en el servidor:
--   * valida que sea TURNO de quien envía (current_turn = auth.uid())
--   * valida la versión del tablero (rev) para descartar tableros obsoletos
--   * alterna automáticamente current_turn al oponente
--   * si el cliente reporta resultado ('p1' | 'p2' | 'draw') cierra la ronda,
--     suma el punto y marca la partida como finished (manteniendo scores para
--     la siguiente ronda).
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_turn_move(p_match_id UUID, p_board JSONB, p_rev INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_match public.arcade_matches%ROWTYPE;
    v_next_turn UUID;
    v_status public.arcade_match_status := 'in_progress';
    v_winner_id UUID := NULL;
    v_result TEXT;
    v_scores JSONB;
    v_p1_score INT;
    v_p2_score INT;
BEGIN
    SELECT * INTO v_match
    FROM public.arcade_matches
    WHERE id = p_match_id
      AND (player_1_id = v_user_id OR player_2_id = v_user_id)
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No formas parte de esta partida';
    END IF;

    IF v_match.status <> 'in_progress' THEN
        RAISE EXCEPTION 'La partida no está activa';
    END IF;

    IF v_match.current_turn IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'Aún no es tu turno';
    END IF;

    -- Protección contra tablero obsoleto (desincronización de cliente)
    IF p_rev IS NOT NULL AND p_rev <> v_match.rev THEN
        RAISE EXCEPTION 'Tablero desactualizado, recarga tu vista';
    END IF;

    v_result := p_board->>'result';

    IF v_result IN ('p1', 'p2', 'draw') THEN
        -- Ronda terminada
        v_status := 'finished';
        v_next_turn := NULL;

        IF v_result = 'p1' THEN
            v_winner_id := v_match.player_1_id;
        ELSIF v_result = 'p2' THEN
            v_winner_id := v_match.player_2_id;
        END IF;

        v_p1_score := COALESCE((v_match.scores->>'p1')::int, 0);
        v_p2_score := COALESCE((v_match.scores->>'p2')::int, 0);

        IF v_result = 'p1' THEN
            v_p1_score := v_p1_score + 1;
            PERFORM public.sumar_victoria_arcade('P1');
        ELSIF v_result = 'p2' THEN
            v_p2_score := v_p2_score + 1;
            PERFORM public.sumar_victoria_arcade('P2');
        END IF;

        v_scores := jsonb_build_object('p1', v_p1_score, 'p2', v_p2_score);
    ELSE
        -- Turno alternado por la función (autoritativo)
        v_next_turn := CASE
            WHEN v_user_id = v_match.player_1_id THEN v_match.player_2_id
            ELSE v_match.player_1_id
        END;
    END IF;

    UPDATE public.arcade_matches
    SET board_state = p_board,
        current_turn = v_next_turn,
        status = v_status,
        winner_id = v_winner_id,
        scores = COALESCE(v_scores, v_match.scores),
        rev = v_match.rev + 1
    WHERE id = p_match_id
    RETURNING * INTO v_match;

    RETURN public.arcade_match_to_json(v_match);
END;
$$;

-- ==============================================================================
-- 10. RPC: SIGUIENTE RONDA (mantiene match_id y scores, purga el tablero)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_next_round(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_match public.arcade_matches%ROWTYPE;
BEGIN
    SELECT * INTO v_match
    FROM public.arcade_matches
    WHERE id = p_match_id
      AND (player_1_id = v_user_id OR player_2_id = v_user_id)
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No formas parte de esta partida';
    END IF;

    -- Conserva los IDs de jugadores y el conteo acumulado; purga el tablero
    UPDATE public.arcade_matches
    SET board_state = public.arcade_initial_board(v_match.game_type),
        status = 'in_progress',
        winner_id = NULL,
        current_turn = v_match.player_1_id,
        rev = v_match.rev + 1
    WHERE id = p_match_id
    RETURNING * INTO v_match;

    RETURN public.arcade_match_to_json(v_match);
END;
$$;

-- ==============================================================================
-- 11. RPC: CANCELAR SALA EN ESPERA (el creador abandona antes de que llegue la pareja)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_cancel_waiting(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_match public.arcade_matches%ROWTYPE;
BEGIN
    UPDATE public.arcade_matches
    SET status = 'abandoned'
    WHERE id = p_match_id
      AND status = 'waiting'
      AND player_1_id = v_user_id
    RETURNING * INTO v_match;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No hay una sala en espera que puedas cancelar';
    END IF;

    RETURN public.arcade_match_to_json(v_match);
END;
$$;

-- ==============================================================================
-- 12. LIMPIEZA AUTOMÁTICA: borra partidas finished/abandoned con +1h de inactividad
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.arcade_cleanup_old_matches()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT;
BEGIN
    DELETE FROM public.arcade_matches
    WHERE status IN ('finished', 'abandoned')
      AND updated_at < now() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Programación en Supabase vía pg_cron (si la extensión está habilitada).
-- En Supabase se activa en: Database -> Extensions -> pg_cron.
DO $do$
DECLARE v_job_exists BOOLEAN;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        SELECT EXISTS(
            SELECT 1 FROM cron.job WHERE jobname = 'arcade-limpiar-partidas-viejas'
        ) INTO v_job_exists;
        IF NOT v_job_exists THEN
            PERFORM cron.schedule(
                'arcade-limpiar-partidas-viejas',
                '0 * * * *',
                $$SELECT public.arcade_cleanup_old_matches()$$
            );
        END IF;
    END IF;
END $do$;

-- ==============================================================================
-- 13. POLÍTICAS ROW LEVEL SECURITY (aislamiento estricto de la pareja)
-- ------------------------------------------------------------------------------
-- Solo los 2 integrantes del espacio pueden VER las partidas (requisito para
-- que Supabase Realtime les entregue los cambios), y solo los participantes de
-- la partida pueden MODIFICARLA. Las escrituras sensibles se ejecutan mediante
-- los RPCs SECURITY DEFINER de arriba.
-- ==============================================================================
ALTER TABLE public.arcade_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver partidas de mi espacio" ON public.arcade_matches;
CREATE POLICY "Ver partidas de mi espacio" ON public.arcade_matches
    FOR SELECT TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id());

DROP POLICY IF EXISTS "Crear partidas de mi espacio" ON public.arcade_matches;
CREATE POLICY "Crear partidas de mi espacio" ON public.arcade_matches
    FOR INSERT TO authenticated
    WITH CHECK (
        espacio_id = public.obtener_mi_espacio_id()
        AND player_1_id = auth.uid()
    );

DROP POLICY IF EXISTS "Actualizar solo participantes" ON public.arcade_matches;
CREATE POLICY "Actualizar solo participantes" ON public.arcade_matches
    FOR UPDATE TO authenticated
    USING (player_1_id = auth.uid() OR player_2_id = auth.uid())
    WITH CHECK (
        espacio_id = public.obtener_mi_espacio_id()
        AND (player_1_id = auth.uid() OR player_2_id = auth.uid())
    );

DROP POLICY IF EXISTS "Eliminar solo participantes" ON public.arcade_matches;
CREATE POLICY "Eliminar solo participantes" ON public.arcade_matches
    FOR DELETE TO authenticated
    USING (player_1_id = auth.uid() OR player_2_id = auth.uid());

-- ==============================================================================
-- 14. SUPABASE REALTIME (IDEMPOTENTE)
-- ------------------------------------------------------------------------------
-- Sin REPLICA IDENTITY FULL los UPDATE llegan por Realtime sin datos
-- (payload.new nulo) y el cliente los ignora: ningún juego sincronizaría.
-- ==============================================================================
ALTER TABLE public.arcade_matches REPLICA IDENTITY FULL;
ALTER TABLE public.arcade_trivia_rounds REPLICA IDENTITY FULL;
ALTER TABLE public.arcade_trivia_results REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.arcade_matches;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

-- ==============================================================================
-- 15. TRIVIA MULTIJUGADOR "POR LADO" (cada quien responde en su dispositivo)
-- ------------------------------------------------------------------------------
-- No hay sincronización de respuestas en vivo. Únicamente se abre una ronda
-- compartida (round_id), cada participante anota sus aciertos al terminar su
-- quiz local, y la pantalla compara ambos marcadores en tiempo real.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.arcade_trivia_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espacio_id UUID NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
    player_1_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    player_2_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trivia_rounds_espacio
    ON public.arcade_trivia_rounds (espacio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.arcade_trivia_results (
    round_id UUID NOT NULL REFERENCES public.arcade_trivia_rounds(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    aciertos INT NOT NULL DEFAULT 0,
    total INT NOT NULL DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (round_id, usuario_id)
);

-- RPC: abrir / reutilizar la ronda de trivia del espacio
CREATE OR REPLACE FUNCTION public.trivia_begin_round()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_espacio_id UUID := public.obtener_mi_espacio_id();
    v_round public.arcade_trivia_rounds%ROWTYPE;
BEGIN
    IF v_espacio_id IS NULL THEN
        RAISE EXCEPTION 'Usuario sin espacio';
    END IF;

    -- Reusar una ronda abierta donde ya participo (menos de 30 min de antigüedad)
    SELECT r.* INTO v_round
    FROM public.arcade_trivia_rounds r
    WHERE r.espacio_id = v_espacio_id
      AND (r.player_1_id = v_user_id OR r.player_2_id = v_user_id)
      AND r.created_at > now() - INTERVAL '30 minutes'
    ORDER BY r.created_at DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        -- Unirse a la ronda abierta de la pareja
        SELECT r.* INTO v_round
        FROM public.arcade_trivia_rounds r
        WHERE r.espacio_id = v_espacio_id
          AND r.player_1_id <> v_user_id
          AND r.player_2_id IS NULL
          AND r.created_at > now() - INTERVAL '30 minutes'
        ORDER BY r.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;

        IF FOUND THEN
            UPDATE public.arcade_trivia_rounds
            SET player_2_id = v_user_id
            WHERE id = v_round.id
            RETURNING * INTO v_round;
        ELSE
            INSERT INTO public.arcade_trivia_rounds (espacio_id, player_1_id)
            VALUES (v_espacio_id, v_user_id)
            RETURNING * INTO v_round;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'round_id', v_round.id,
        'player_1_id', v_round.player_1_id,
        'player_2_id', v_round.player_2_id
    );
END;
$$;

-- RPC: registrar mis aciertos al terminar mi trivia local
CREATE OR REPLACE FUNCTION public.trivia_submit_result(p_round_id UUID, p_aciertos INT, p_total INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_round public.arcade_trivia_rounds%ROWTYPE;
BEGIN
    SELECT * INTO v_round
    FROM public.arcade_trivia_rounds
    WHERE id = p_round_id
      AND (player_1_id = v_user_id OR player_2_id = v_user_id);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No formas parte de esta ronda de trivia';
    END IF;

    INSERT INTO public.arcade_trivia_results (round_id, usuario_id, aciertos, total)
    VALUES (p_round_id, v_user_id, p_aciertos, p_total)
    ON CONFLICT (round_id, usuario_id)
    DO UPDATE SET aciertos = EXCLUDED.aciertos, total = EXCLUDED.total, creado_en = now();

    RETURN jsonb_build_object('round_id', p_round_id, 'ok', true);
END;
$$;

-- Limpieza de rondas de trivia viejas (30 min)
CREATE OR REPLACE FUNCTION public.trivia_cleanup_old_rounds()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT;
BEGIN
    DELETE FROM public.arcade_trivia_rounds
    WHERE created_at < now() - INTERVAL '1 hour';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

DO $do$
DECLARE v_job_exists BOOLEAN;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        SELECT EXISTS(
            SELECT 1 FROM cron.job WHERE jobname = 'arcade-limpiar-trivia-vieja'
        ) INTO v_job_exists;
        IF NOT v_job_exists THEN
            PERFORM cron.schedule(
                'arcade-limpiar-trivia-vieja',
                '30 * * * *',
                $$SELECT public.trivia_cleanup_old_rounds()$$
            );
        END IF;
    END IF;
END $do$;

-- RLS: aislamiento por pareja
ALTER TABLE public.arcade_trivia_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_trivia_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver rondas de trivia de mi espacio" ON public.arcade_trivia_rounds;
CREATE POLICY "Ver rondas de trivia de mi espacio" ON public.arcade_trivia_rounds
    FOR SELECT TO authenticated
    USING (espacio_id = public.obtener_mi_espacio_id());

DROP POLICY IF EXISTS "Crear rondas de trivia de mi espacio" ON public.arcade_trivia_rounds;
CREATE POLICY "Crear rondas de trivia de mi espacio" ON public.arcade_trivia_rounds
    FOR INSERT TO authenticated
    WITH CHECK (espacio_id = public.obtener_mi_espacio_id());

DROP POLICY IF EXISTS "Ver resultados de trivia de mi espacio" ON public.arcade_trivia_results;
CREATE POLICY "Ver resultados de trivia de mi espacio" ON public.arcade_trivia_results
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.arcade_trivia_rounds r
            WHERE r.id = round_id
              AND r.espacio_id = public.obtener_mi_espacio_id()
        )
    );

DROP POLICY IF EXISTS "Registrar mis resultados de trivia" ON public.arcade_trivia_results;
CREATE POLICY "Registrar mis resultados de trivia" ON public.arcade_trivia_results
    FOR INSERT TO authenticated
    WITH CHECK (usuario_id = auth.uid());

DROP POLICY IF EXISTS "Actualizar mis resultados de trivia" ON public.arcade_trivia_results;
CREATE POLICY "Actualizar mis resultados de trivia" ON public.arcade_trivia_results
    FOR UPDATE TO authenticated
    USING (usuario_id = auth.uid())
    WITH CHECK (usuario_id = auth.uid());

-- Realtime
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.arcade_trivia_rounds;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.arcade_trivia_results;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;