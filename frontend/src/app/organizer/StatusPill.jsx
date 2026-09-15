/**
 * An event's status, as a word a person recognises.
 *
 * The database enum is `draft | pending_review | rejected | published |
 * suspended | cancelled | completed`, and three of those need translating:
 * "pending_review" is jargon, "suspended" and "rejected" mean different things
 * that both read as "we said no", and the difference matters — a rejected event
 * can go round again, a suspended one is pulled from sale by an admin, and a
 * cancelled one never comes back.
 *
 * THE COLOUR IS A DOT, NOT THE TEXT. This used to tint the label itself —
 * amber `text-warning` at 10px, which is 2.1:1 on its own wash and below the
 * 12px floor the type ramp promises. The words now stay ink, a dot carries the
 * severity (`.es-status` in globals.css), and colour is never the only signal.
 */
const LOOKS = {
  draft: ['Draft', 'neutral'],
  pending_review: ['In review', 'info'],
  rejected: ['Changes needed', 'warning'],
  published: ['On sale', 'success'],
  suspended: ['Suspended', 'danger'],
  cancelled: ['Cancelled', 'muted'],
  completed: ['Finished', 'muted'],
};

export default function StatusPill({ status }) {
  const [label, tone] = LOOKS[status] || [status, 'neutral'];
  return <span className="es-status" data-tone={tone}>{label}</span>;
}
