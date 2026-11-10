import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The icons an organizer can put beside a line of a ticket type's details card.
 *
 * The NAMES are a fixed list mirrored in `backend/services/ticketDetails.js`,
 * which refuses any other. A name this file does not know is drawn as the
 * check, so a new server-side icon cannot break a page that predates it.
 *
 * Icons the shell already draws come from NavIcon, so a tag here is the tag
 * everywhere; the rest are drawn on the same 24-unit grid in `currentColor`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const OWN = {
  dinner: ['M3 18.5h18', 'M4.5 18.5a7.5 7.5 0 0 1 15 0', 'M12 11V9', 'M10.5 9h3', 'M8 15.5a4 4 0 0 1 2.5-2.6'],
  drink: ['M5 8h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 9.5h1.5a2.5 2.5 0 0 1 0 5H16', 'M4 20.5h14', 'M9 3.5v2', 'M12 3.5v2'],
  wine: ['M7.5 3h9l-.4 4.6a4.1 4.1 0 0 1-8.2 0z', 'M12 11.7V20', 'M8.5 20.5h7', 'M8 6.5h8'],
  seat: ['M8 3.5h8a1 1 0 0 1 1 1V11H7V4.5a1 1 0 0 1 1-1z', 'M5.5 11h13v3h-13z', 'M7 14v6.5', 'M17 14v6.5'],
  table: ['M3 8.5h18v2.5H3z', 'M6 11v9', 'M18 11v9', 'M9 15.5h6'],
  music: ['M9 18V5.5l11-2V16', 'M6.5 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M17.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  gift: ['M4.5 11h15v9.5h-15z', 'M3 7.5h18V11H3z', 'M12 7.5v13', 'M12 7.5S10.4 3.5 8 4c-2 .4-1.4 3.5 4 3.5z', 'M12 7.5s1.6-4 4-3.5c2 .4 1.4 3.5-4 3.5z'],
  parking: ['M4 4h16v16H4z', 'M10 17V8h3a2.5 2.5 0 0 1 0 5h-3'],
  camera: ['M3 8h4l2-2.5h6L17 8h4v11H3z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  accessible: ['M12 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M11 8v6h5.5l2 5', 'M11 10.5h4.5', 'M8.2 11.2a5 5 0 1 0 7.3 6.6'],
};

/** Shell icons used under their own name, and the ones renamed for this list. */
const SHELL = { check: 'check', users: 'users', tag: 'tag', shield: 'shield', ticket: 'ticket', star: 'star', crown: 'crown', clock: 'clock', door: 'door', info: 'info' };

/** The picker's order and the words beside each icon. */
export const DETAIL_ICONS = [
  ['check', 'Included'], ['dinner', 'Dinner'], ['drink', 'Drinks'], ['wine', 'Wine'],
  ['users', 'Guests'], ['seat', 'Seat'], ['table', 'Table'], ['crown', 'VIP'], ['star', 'Premium'],
  ['music', 'Music'], ['gift', 'Gift'], ['camera', 'Photo'], ['parking', 'Parking'],
  ['door', 'Entry'], ['clock', 'Time'], ['accessible', 'Accessible'], ['ticket', 'Ticket'],
  ['tag', 'Price'], ['shield', 'Guarantee'], ['info', 'Note'],
];

export default function TierDetailIcon({ name, size = 22, className = '' }) {
  if (!OWN[name]) return <NavIcon name={SHELL[name] || 'check'} size={size} className={className} />;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}
    >
      {OWN[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
