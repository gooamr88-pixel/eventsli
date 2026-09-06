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
 * Colour carries severity and is separate from the brand accent: green here
 * means live, not "primary action".
 */
const LOOKS = {
  draft: ['Draft', 'bg-bg-sunken text-muted'],
  pending_review: ['In review', 'bg-info/15 text-info'],
  rejected: ['Changes needed', 'bg-warning/15 text-warning'],
  published: ['On sale', 'bg-success/15 text-success'],
  suspended: ['Suspended', 'bg-danger/15 text-danger'],
  cancelled: ['Cancelled', 'bg-danger/10 text-muted'],
  completed: ['Finished', 'bg-bg-sunken text-subtle'],
};

export default function StatusPill({ status }) {
  const [label, look] = LOOKS[status] || [status, 'bg-bg-sunken text-muted'];
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.09em] ${look}`}
    >
      {label}
    </span>
  );
}
