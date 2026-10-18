-- ═══════════════════════════════════════════════════════════════════════════
-- AI GENERATIONS — the daily allowance, counted where it cannot be raced.
--
-- Eventsli AI (the Smart Event Creator now, the Seating Designer next) calls
-- an outside model on an organizer's behalf. Each organizer gets TWO
-- generations per rolling 24 hours, shared across both features (owner
-- decisions D-002, D-009). This table is that count.
--
-- WHY IN THE DATABASE. The API runs under pm2 in cluster mode, so a counter
-- in memory is one per worker, and a check-then-insert in JavaScript lets two
-- tabs both see "1 left" and both spend it. The reservation below takes a row
-- lock on the organizer first, so two requests for the same organizer queue
-- behind each other and the second one sees the first one's row.
--
-- RESERVE, THEN FINISH (D-010). A generation is reserved before the provider
-- is called and only COUNTS once it is marked `succeeded`. If every provider
-- fails, or the output fails validation, it is `released` and costs nothing.
-- A reservation whose worker died mid-call stops counting after two minutes,
-- so a crash never eats somebody's allowance.
--
-- WHAT IS NOT HERE: the organizer's description and the model's answer. Only
-- metadata — when, which provider, how long, how many tokens, what failed
-- (D-020). The draft itself lives in the browser until it is saved as an
-- ordinary event through the ordinary endpoints.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_generations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  feature       TEXT NOT NULL,
  -- Minted by the browser per press of "Generate". A retried request with the
  -- same id finds this row instead of spending a second generation.
  request_id    UUID NOT NULL,
  status        TEXT NOT NULL DEFAULT 'reserved',
  provider      TEXT,
  model         TEXT,
  attempts      SMALLINT NOT NULL DEFAULT 0,
  input_chars   INT,
  input_tokens  INT,
  output_tokens INT,
  latency_ms    INT,
  failure_code  TEXT,
  -- The event this draft became, set when the organizer saves it. What lets a
  -- reviewer see "AI-assisted" on the event they are approving.
  event_id      UUID REFERENCES events(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,

  CONSTRAINT ai_generations_feature CHECK (feature IN ('event_creator', 'seating_designer')),
  CONSTRAINT ai_generations_status  CHECK (status IN ('reserved', 'succeeded', 'released')),
  CONSTRAINT ai_generations_request UNIQUE (organizer_id, request_id),
  CONSTRAINT ai_generations_failure_code CHECK (failure_code IS NULL OR length(failure_code) <= 64)
);

-- The window query reads one organizer's recent rows that still count.
CREATE INDEX IF NOT EXISTS ai_generations_window
  ON ai_generations (organizer_id, created_at DESC) WHERE status <> 'released';
-- The platform-wide daily cap reads every organizer's successes in the window.
CREATE INDEX IF NOT EXISTS ai_generations_succeeded
  ON ai_generations (created_at DESC) WHERE status = 'succeeded';
CREATE INDEX IF NOT EXISTS ai_generations_event ON ai_generations (event_id) WHERE event_id IS NOT NULL;

-- The API reaches this table with the service role only. RLS on with no
-- policies, and nothing granted to the browser roles, so the Data API cannot
-- read anybody's usage even if a key leaks.
ALTER TABLE ai_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_generations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_generations TO service_role;


-- ─── Reserve one generation ────────────────────────────────────────────────
-- Answers one of:
--   { ok: true,  id, remaining, next_available_at }      reserved
--   { ok: false, reason: 'LIMIT',       next_available_at }
--   { ok: false, reason: 'GLOBAL_CAP' }                    the platform's daily ceiling
--   { ok: false, reason: 'IN_PROGRESS', id }               same request_id, still running
--   { ok: false, reason: 'DUPLICATE',   id, status }       same request_id, already finished
--   { ok: false, reason: 'NO_ORGANIZER' }
--
-- `p_global_cap` NULL means no platform ceiling.
CREATE OR REPLACE FUNCTION ai_reserve_generation(
  p_organizer  UUID,
  p_user       UUID,
  p_feature    TEXT,
  p_request    UUID,
  p_limit      INT,
  p_window     INTERVAL,
  p_stale      INTERVAL,
  p_global_cap INT
) RETURNS JSONB AS $$
DECLARE
  v_existing  ai_generations%ROWTYPE;
  v_succeeded INT;
  v_inflight  INT;
  v_next      TIMESTAMPTZ;
  v_global    INT;
  v_id        UUID;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'AI_LIMIT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Serialise this organizer's reservations. Everything below reads the rows
  -- as they stand once the lock is held.
  PERFORM 1 FROM organizers WHERE id = p_organizer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ORGANIZER');
  END IF;

  SELECT * INTO v_existing FROM ai_generations
   WHERE organizer_id = p_organizer AND request_id = p_request;
  IF FOUND THEN
    IF v_existing.status = 'reserved' AND v_existing.created_at > now() - p_stale THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'IN_PROGRESS', 'id', v_existing.id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'DUPLICATE',
                              'id', v_existing.id, 'status', v_existing.status);
  END IF;

  SELECT count(*) INTO v_succeeded FROM ai_generations
   WHERE organizer_id = p_organizer AND status = 'succeeded'
     AND created_at > now() - p_window;
  SELECT count(*) INTO v_inflight FROM ai_generations
   WHERE organizer_id = p_organizer AND status = 'reserved'
     AND created_at > now() - p_stale;

  IF v_succeeded + v_inflight >= p_limit THEN
    IF v_succeeded >= p_limit THEN
      -- The moment enough of the counted ones age out of the window to leave
      -- one slot: with a limit of 2 and 2 used, when the older one turns 24h.
      SELECT created_at + p_window INTO v_next FROM ai_generations
       WHERE organizer_id = p_organizer AND status = 'succeeded'
         AND created_at > now() - p_window
       ORDER BY created_at ASC
       OFFSET (v_succeeded - p_limit) LIMIT 1;
    ELSE
      -- Held by a request still running. It either succeeds or is released
      -- within the stale interval.
      SELECT min(created_at) + p_stale INTO v_next FROM ai_generations
       WHERE organizer_id = p_organizer AND status = 'reserved'
         AND created_at > now() - p_stale;
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'LIMIT', 'next_available_at', v_next);
  END IF;

  IF p_global_cap IS NOT NULL THEN
    SELECT count(*) INTO v_global FROM ai_generations
     WHERE status = 'succeeded' AND created_at > now() - p_window;
    IF v_global >= p_global_cap THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'GLOBAL_CAP');
    END IF;
  END IF;

  INSERT INTO ai_generations (organizer_id, user_id, feature, request_id)
  VALUES (p_organizer, p_user, p_feature, p_request)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    -- What will be left if this one succeeds.
    'remaining', GREATEST(p_limit - v_succeeded - v_inflight - 1, 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ─── Finish a reservation ──────────────────────────────────────────────────
-- Only a `reserved` row moves, and only to `succeeded` or `released`: a
-- generation that already counted can never be released after the fact, and
-- one released cannot be counted later. Returns whether the row moved.
CREATE OR REPLACE FUNCTION ai_finish_generation(
  p_id     UUID,
  p_status TEXT,
  p_meta   JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  v_rows INT;
BEGIN
  IF p_status NOT IN ('succeeded', 'released') THEN
    RAISE EXCEPTION 'AI_STATUS_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE ai_generations SET
    status        = p_status,
    provider      = left(p_meta->>'provider', 32),
    model         = left(p_meta->>'model', 80),
    attempts      = COALESCE((p_meta->>'attempts')::SMALLINT, attempts),
    input_chars   = (p_meta->>'input_chars')::INT,
    input_tokens  = (p_meta->>'input_tokens')::INT,
    output_tokens = (p_meta->>'output_tokens')::INT,
    latency_ms    = (p_meta->>'latency_ms')::INT,
    failure_code  = left(p_meta->>'failure_code', 64),
    finished_at   = now()
  WHERE id = p_id AND status = 'reserved';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ─── Where an organizer stands, without reserving anything ─────────────────
-- What the "2 of 2 left today" dots read. Same counting rules as the reserve.
CREATE OR REPLACE FUNCTION ai_generation_status(
  p_organizer UUID,
  p_limit     INT,
  p_window    INTERVAL,
  p_stale     INTERVAL
) RETURNS JSONB AS $$
DECLARE
  v_succeeded INT;
  v_inflight  INT;
  v_next      TIMESTAMPTZ;
BEGIN
  SELECT count(*) INTO v_succeeded FROM ai_generations
   WHERE organizer_id = p_organizer AND status = 'succeeded'
     AND created_at > now() - p_window;
  SELECT count(*) INTO v_inflight FROM ai_generations
   WHERE organizer_id = p_organizer AND status = 'reserved'
     AND created_at > now() - p_stale;

  IF v_succeeded >= p_limit THEN
    SELECT created_at + p_window INTO v_next FROM ai_generations
     WHERE organizer_id = p_organizer AND status = 'succeeded'
       AND created_at > now() - p_window
     ORDER BY created_at ASC
     OFFSET (v_succeeded - p_limit) LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'used', v_succeeded,
    'in_flight', v_inflight,
    'remaining', GREATEST(p_limit - v_succeeded - v_inflight, 0),
    'next_available_at', v_next
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;


REVOKE ALL ON FUNCTION ai_reserve_generation(UUID, UUID, TEXT, UUID, INT, INTERVAL, INTERVAL, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_finish_generation(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_generation_status(UUID, INT, INTERVAL, INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_reserve_generation(UUID, UUID, TEXT, UUID, INT, INTERVAL, INTERVAL, INT) TO service_role;
GRANT EXECUTE ON FUNCTION ai_finish_generation(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION ai_generation_status(UUID, INT, INTERVAL, INTERVAL) TO service_role;
