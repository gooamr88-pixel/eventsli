/**
 * ─────────────────────────────────────────────────────────────────────────────
 * N seats of one ticket type, for "Add to cart" on its details card.
 *
 * Seats sit in lines: a row of a section, or the seats round a table. Within a
 * line they are ordered by seat number, and a run of N free seats in a row is
 * what a group buying together wants. So:
 *
 *   • with an ANCHOR (the seat the buyer tapped), it is always included, then
 *     the free seats nearest it in its own line, then the fullest other lines;
 *   • without one, the first unbroken run of N free seats in any line, the
 *     line with the most free seats tried first;
 *   • failing a run, the fullest lines are filled in turn, so the party is
 *     split across as few lines as possible.
 *
 * It may return fewer than N when fewer are free; the caller says so. Nothing
 * here is a promise: the hold decides, and a seat taken in the meantime comes
 * back as the usual "someone else got there first".
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function pickSeats(seats, tierId, n, takenIds = new Set(), anchor = null) {
  if (!n || n < 1) return [];
  const free = (s) => s.available && s.tierId === tierId && !takenIds.has(s.id);
  const lineOf = (s) => `${s.tableId || ''}|${s.section || ''}|${s.row || ''}`;

  const lines = new Map();
  for (const s of seats || []) {
    if (s.tierId !== tierId) continue;
    const key = lineOf(s);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(s);
  }
  const ordered = [...lines.values()]
    .map((line) => line.sort((a, b) => seatNo(a) - seatNo(b)))
    .sort((a, b) => b.filter(free).length - a.filter(free).length);

  if (anchor && free({ ...anchor, available: anchor.available !== false })) {
    const home = lines.get(lineOf(anchor)) || [anchor];
    const at = Math.max(0, home.findIndex((s) => s.id === anchor.id));
    const near = home
      .map((s, i) => [s, Math.abs(i - at), i < at])
      .filter(([s]) => s.id !== anchor.id && free(s))
      // Nearest first; on a tie, the seat to the right, so a pair grows the
      // same way every time.
      .sort((a, b) => a[1] - b[1] || Number(a[2]) - Number(b[2]))
      .map(([s]) => s);
    const rest = ordered.filter((line) => line !== home).flat().filter(free);
    return [anchor, ...near, ...rest].slice(0, n);
  }

  for (const line of ordered) {
    for (let i = 0; i + n <= line.length; i += 1) {
      const run = line.slice(i, i + n);
      if (run.every(free)) return run;
    }
  }
  return ordered.flat().filter(free).slice(0, n);
}

function seatNo(s) {
  const n = Number.parseInt(String(s.number ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}
