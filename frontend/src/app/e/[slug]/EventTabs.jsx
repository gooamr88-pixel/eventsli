'use client';

import { useId, useRef, useState } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * About · Lineup · Venue · FAQs — the event page's sections, as tabs.
 *
 * A TAB ONLY EXISTS WHEN IT HAS SOMETHING IN IT. Most events have no lineup and
 * no policies, and a "Lineup" tab that opens onto nothing is worse than no tab:
 * the reader has to spend a click to find out it was empty, and does it once
 * per tab. The caller passes every panel it has; this renders the ones with
 * content and silently drops the rest. One panel left means no tab bar at all —
 * a single tab is a heading pretending to be a control.
 *
 *
 * WHY EVERY PANEL STAYS IN THE DOM.
 *
 * Inactive panels are `hidden`, not unmounted. Three reasons, in order of how
 * much they matter:
 *
 *   1. SEARCH. This is the page the whole platform exists to get people to.
 *      Content mounted only on click is content a crawler has to execute
 *      JavaScript and simulate a click to find — so the schedule and the venue
 *      details would stop being reasons anybody arrives here.
 *   2. Sharing a link to the page shows the same document to everybody,
 *      whatever tab they happen to open.
 *   3. Switching tabs costs nothing, because nothing is being built.
 *
 *
 * THE KEYBOARD IS THE ARIA PATTERN, NOT A GUESS. Arrow keys move between tabs,
 * Home and End jump to the ends, and only the selected tab is in the tab order
 * — so Tab moves from the tab bar INTO the panel rather than through four tabs
 * first. That last part is the one most implementations miss, and it is the
 * difference between tabs and four buttons.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventTabs({ panels }) {
  const id = useId();
  const available = (panels || []).filter((p) => p && p.content);
  const [active, setActive] = useState(0);
  const tabRefs = useRef([]);

  if (available.length === 0) return null;

  // One section is a section, not a tab. Rendered plainly, with its own heading
  // left to the panel itself.
  if (available.length === 1) {
    return <div className="fx-stack">{available[0].content}</div>;
  }

  const current = Math.min(active, available.length - 1);

  function onKeyDown(e) {
    const last = available.length - 1;
    const move = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[e.key];

    if (move === undefined) return;
    e.preventDefault();
    setActive(move);
    // Focus follows selection, which is the automatic-activation pattern: with
    // every panel already in the DOM there is nothing slow to activate, so
    // making the reader press Enter as well would be ceremony.
    tabRefs.current[move]?.focus();
  }

  return (
    <div className="fx-stack">
      {/* Scrolls sideways rather than wrapping. Four tabs fit a phone; a fifth
          one added later would otherwise silently become a second row that
          looks like a different control. */}
      <div className="fx-scroll-x border-b border-border-base">
        <div role="tablist" aria-label="About this event" onKeyDown={onKeyDown} className="fx-row gap-1">
          {available.map((panel, index) => {
            const selected = index === current;
            return (
              <button
                key={panel.key}
                type="button"
                role="tab"
                id={`${id}-tab-${panel.key}`}
                aria-controls={`${id}-panel-${panel.key}`}
                aria-selected={selected}
                // Only the selected tab is reachable by Tab; the arrows move
                // between them. Without this, reaching the panel means tabbing
                // through every tab first.
                tabIndex={selected ? 0 : -1}
                ref={(node) => { tabRefs.current[index] = node; }}
                onClick={() => setActive(index)}
                className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm transition-colors ${
                  selected
                    ? 'border-accent font-medium text-accent'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {panel.label}
              </button>
            );
          })}
        </div>
      </div>

      {available.map((panel, index) => (
        <div
          key={panel.key}
          role="tabpanel"
          id={`${id}-panel-${panel.key}`}
          aria-labelledby={`${id}-tab-${panel.key}`}
          hidden={index !== current}
          // Focusable, so the keyboard lands somewhere after leaving the tab
          // bar even when the panel holds no control of its own.
          tabIndex={0}
          className="fx-stack outline-none"
        >
          {panel.content}
        </div>
      ))}
    </div>
  );
}
