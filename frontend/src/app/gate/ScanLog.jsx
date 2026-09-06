'use client';

import { describeScan, doorTime } from './scanOutcome';

/**
 * The last few scans, newest first.
 *
 * Queued and settled entries are in ONE list, not two. An operator asking "did
 * that go through?" is asking about a particular guest, not about a transport
 * state — so the guest's row is where the answer belongs, and a scan that has
 * not reached the server says so on its own line rather than in a separate
 * panel they would have to think to open.
 */
const TONE_TEXT = {
  admit: 'text-success',
  refuse: 'text-danger',
  warn: 'text-warning',
  hold: 'text-subtle',
};

export default function ScanLog({ records, limit = 20 }) {
  const rows = [...records]
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
    .slice(0, limit);

  if (!rows.length) {
    return <p className="text-sm text-subtle">Nothing scanned on this device yet.</p>;
  }

  return (
    <ul className="fx-stack fx-stack--sm">
      {rows.map((r) => {
        const result = r.state === 'done' ? r.result : r.state === 'sending' ? 'sending' : 'queued';
        const { tone, title } = describeScan(result);
        return (
          <li
            key={r.clientScanId}
            className="fx-row fx-row--between rounded-[--es-radius-md] bg-surface px-3 py-2"
          >
            <span className="fx-min0 fx-truncate text-sm text-ink">
              {r.attendee || <span className="text-subtle">No name</span>}
            </span>
            <span className="fx-row shrink-0">
              <span className={`whitespace-nowrap text-sm ${TONE_TEXT[tone] || 'text-muted'}`}>
                {title}
              </span>
              <span className="whitespace-nowrap font-mono text-xs text-subtle">
                {doorTime(r.occurredAt)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
