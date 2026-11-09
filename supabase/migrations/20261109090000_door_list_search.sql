-- Guest search at the door, by name the way people say it.
--
-- 20261108100000 matched the typed text as one phrase, so "Smith John",
-- "smith, john" and "chloe" (for Chloé) found nobody. This version folds case
-- and accents on both sides and matches word by word: every word typed must
-- appear in the guest's name or address, in any order. The start of a ticket
-- number still matches the whole query.
--
-- No extension. `unaccent` sits in different schemas on different projects,
-- and its one-argument form cannot find its dictionary from a SECURITY DEFINER
-- function pinned to search_path = public. The table below covers the Latin
-- letters that names carry; anything else is matched as typed.

-- Lower case, Latin accents removed, ß / æ / œ spelled out. NULL becomes ''.
CREATE OR REPLACE FUNCTION door_fold(p TEXT) RETURNS TEXT AS $$
  SELECT replace(replace(replace(replace(replace(
           translate(lower(COALESCE(p, '')),
             'àÀáÁâÂãÃäÄåÅāĀăĂąĄçÇćĆčČďĎđĐèÈéÉêÊëËēĒėĖęĘěĚğĞìÌíÍîÎïÏīĪįĮłŁľĽĺĹñÑńŃňŇòÒóÓôÔõÕöÖøØōŌőŐřŘŕŔśŚšŠşŞșȘťŤţŢțȚùÙúÚûÛüÜūŪůŮűŰųŲýÝÿŸźŹżŻžŽ',
             'aaaaaaaaaaaaaaaaaaccccccddddeeeeeeeeeeeeeeeeggiiiiiiiiiiiillllllnnnnnnoooooooooooooooorrrrssssssssttttttuuuuuuuuuuuuuuuuyyyyzzzzzz'),
           'ß', 'ss'), 'æ', 'ae'), 'Æ', 'ae'), 'œ', 'oe'), 'Œ', 'oe');
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public;

-- ─── The door list ─────────────────────────────────────────────────────────
-- Valid and admitted tickets on paid orders. The address is matched, never
-- returned. Words are compared with strpos, not LIKE, so nothing typed is a
-- pattern; the API still strips LIKE wildcards for the ticket-number match.
CREATE OR REPLACE FUNCTION event_door_list(
  p_event_id UUID, p_q TEXT DEFAULT NULL, p_status TEXT DEFAULT 'all',
  p_limit INT DEFAULT 50, p_offset INT DEFAULT 0
) RETURNS JSONB AS $$
  WITH search AS (
    SELECT NULLIF(btrim(p_q), '') AS raw,
           ARRAY(SELECT w
                   FROM regexp_split_to_table(door_fold(btrim(p_q)), '[[:space:],;]+') AS w
                  WHERE w <> ''
                  LIMIT 8) AS words
  ),
  base AS (
    SELECT t.id, t.status, t.scanned_at,
           door_holder(t.attendee_name, t.transfer_count, o.guest_name, p.full_name) AS holder,
           NULLIF(btrim(t.attendee_name), '') IS NULL AND t.transfer_count = 0 AS holder_is_buyer,
           COALESCE(t.attendee_email::TEXT, o.guest_email::TEXT, p.email::TEXT) AS email,
           tt.name AS tier,
           CASE WHEN s.seat_number IS NOT NULL
             THEN concat_ws(' ', s.section_key, concat(s.row_label, s.seat_number)) END AS seat,
           tb.label AS table_label
      FROM tickets t
      JOIN orders o             ON o.id = t.order_id AND o.status = 'paid'
      LEFT JOIN profiles p      ON p.id = o.user_id
      LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
      LEFT JOIN seats s         ON s.id = t.seat_id
      LEFT JOIN tables tb       ON tb.id = t.table_id
     WHERE t.event_id = p_event_id
       AND t.status IN ('valid', 'scanned')
  ),
  filtered AS (
    SELECT b.*
      FROM base b, search q
     WHERE (COALESCE(p_status, 'all') = 'all'
            OR (p_status = 'in'  AND b.status = 'scanned')
            OR (p_status = 'out' AND b.status = 'valid'))
       AND (q.raw IS NULL
            OR b.id::TEXT LIKE lower(q.raw) || '%'
            OR (cardinality(q.words) > 0 AND NOT EXISTS (
                  SELECT 1
                    FROM unnest(q.words) AS w
                   WHERE strpos(door_fold(b.holder) || ' ' || door_fold(b.email), w) = 0)))
  ),
  page AS (
    SELECT * FROM filtered
     ORDER BY holder NULLS LAST, id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ticketId', id, 'status', status, 'scannedAt', scanned_at,
               'holder', holder, 'holderIsBuyer', holder IS NOT NULL AND holder_is_buyer,
               'tier', tier, 'seat', seat, 'table', table_label)
             ORDER BY holder NULLS LAST, id)
        FROM page), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── Privileges ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION door_fold(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION event_door_list(UUID, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION door_fold(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION event_door_list(UUID, TEXT, TEXT, INT, INT) TO service_role;
