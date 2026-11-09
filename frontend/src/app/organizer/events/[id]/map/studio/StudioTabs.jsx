'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Venue Studio's five workspaces, in the order a venue is built: who the
 * venue is, its seats, how it looks in 3D, what each seat sees, and what a
 * buyer will get. Tabs rather than a wizard: an organizer returns to fix one
 * row, and making them walk five steps to reach it is a wizard's worst habit.
 *
 * Every tab edits the same draft and the header's one Save keeps it all, so
 * moving between them never loses anything.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const STUDIO_TABS = Object.freeze([
  { key: 'venue', label: 'Venue', hint: 'Name, photo, access' },
  { key: 'layout', label: 'Layout', hint: '2D seating design' },
  { key: '3d', label: '3D', hint: 'The room in 3D' },
  { key: '360', label: '360°', hint: 'Views from seats' },
  { key: 'preview', label: 'Preview', hint: 'Buyer view, seat holds' },
]);

export default function StudioTabs({ value, onChange, badges = {} }) {
  const onKey = (e) => {
    const i = STUDIO_TABS.findIndex((t) => t.key === value);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = STUDIO_TABS[(i + step + STUDIO_TABS.length) % STUDIO_TABS.length];
    onChange(next.key);
    e.currentTarget.querySelector(`#studio-tab-${next.key}`)?.focus();
  };
  return (
    <nav className="es-studiotabs" aria-label="Venue Studio">
      <div role="tablist" aria-label="Venue Studio workspaces" className="es-studiotabs__list" onKeyDown={onKey}>
        {STUDIO_TABS.map((t, i) => {
          const on = t.key === value;
          return (
            <button
              key={t.key}
              id={`studio-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="studio-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(t.key)}
              className="es-studiotabs__tab"
            >
              <span className="es-studiotabs__num es-nums" aria-hidden="true">{i + 1}</span>
              <span className="fx-min0">
                <b>{t.label}</b>
                <small>{badges[t.key] || t.hint}</small>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
