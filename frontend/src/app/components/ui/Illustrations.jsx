/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Small decorative pictures for the account pages, drawn inline in the brand's
 * own tokens — no image files, nothing fetched, and they follow the palette if
 * it ever changes. Always `aria-hidden`: each sits beside a heading that says
 * the same thing in words.
 *
 * Deliberately NOT anybody's logo. The Stripe card says "Stripe" in text, as a
 * label; drawing Stripe's (or a bank's) mark would be imitating their brand.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const svg = { 'aria-hidden': true, focusable: 'false', xmlns: 'http://www.w3.org/2000/svg' };

function Burst({ x, y }) {
  return (
    <g className="es-art__burst" transform={`translate(${x} ${y})`}>
      <path d="M0 14 4 2" />
      <path d="M10 20 22 12" />
      <path d="M12 30h12" />
    </g>
  );
}

/** Two payment cards on a soft blob. `label` is printed on a chip, as text. */
export function CardsArt({ label, className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 320 200" className={`es-art ${className}`}>
      <path className="es-art__blob" d="M40 120c0-50 50-90 120-88s130 30 130 86-60 80-130 78S40 170 40 120z" />
      <g transform="rotate(-8 170 110)">
        <rect className="es-art__card es-art__card--back" x="95" y="48" width="150" height="92" rx="12" />
        <rect className="es-art__card" x="80" y="66" width="150" height="92" rx="12" />
        <rect className="es-art__chip" x="98" y="86" width="26" height="18" rx="4" />
        <path className="es-art__line" d="M98 132h40M146 132h24" />
        <path className="es-art__wave" d="M196 86c4 4 4 10 0 14M204 82c7 7 7 18 0 22" />
      </g>
      {label && (
        <g>
          <rect className="es-art__pill" x="196" y="134" width="96" height="40" rx="10" />
          <text className="es-art__pilltext" x="244" y="160" textAnchor="middle">{label}</text>
        </g>
      )}
      <Burst x={232} y={10} />
    </svg>
  );
}

/** A bank front with a stack of coins. */
export function BankArt({ className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 320 200" className={`es-art ${className}`}>
      <path className="es-art__blob" d="M50 118c0-48 48-86 116-84s124 28 124 82-58 78-124 76S50 166 50 118z" />
      <path className="es-art__card" d="M110 74 170 44l60 30z" />
      <rect className="es-art__card" x="112" y="78" width="116" height="8" rx="2" />
      {[124, 150, 176, 202].map((x) => <rect key={x} className="es-art__card es-art__card--back" x={x} y="90" width="12" height="54" rx="3" />)}
      <rect className="es-art__card" x="104" y="146" width="132" height="12" rx="3" />
      <circle className="es-art__chip" cx="170" cy="62" r="6" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(70 ${150 - i * 14})`}>
          <ellipse className="es-art__coin" cx="0" cy="8" rx="30" ry="9" />
          <ellipse className="es-art__coin es-art__coin--top" cx="0" cy="3" rx="30" ry="9" />
        </g>
      ))}
      <Burst x={236} y={14} />
    </svg>
  );
}

/** A market stall with an awning and a ticket — "who you are" to buyers. */
export function StoreArt({ className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 320 200" className={`es-art ${className}`}>
      <path className="es-art__blob" d="M40 120c0-52 52-90 124-88s126 30 126 86-60 80-130 78S40 172 40 120z" />
      <rect className="es-art__card es-art__card--back" x="96" y="70" width="140" height="96" rx="6" />
      <path className="es-art__awning" d="M88 52h156l-8 30H96z" />
      {[0, 1, 2, 3].map((i) => <path key={i} className="es-art__stripe" d={`M${104 + i * 36} 52h18l-4 30h-18z`} />)}
      <rect className="es-art__card" x="150" y="104" width="52" height="40" rx="4" />
      <g transform="rotate(-6 110 128)">
        <rect className="es-art__ticket" x="72" y="110" width="74" height="40" rx="6" />
        <path className="es-art__line" d="M86 124h30M86 134h20" />
      </g>
      <path className="es-art__line" d="M236 70v96" />
      <Burst x={244} y={10} />
    </svg>
  );
}

/** A tilted ticket stub with a ticket mark and two printed lines, on a blob —
 *  "no orders yet". */
export function OrderTicketArt({ className = '' }) {
  const stub = 'M10 0H100A10 10 0 0 1 110 10V64A11 11 0 0 0 110 86V140A10 10 0 0 1 100 150H10A10 10 0 0 1 0 140V86A11 11 0 0 0 0 64V10A10 10 0 0 1 10 0Z';
  return (
    <svg {...svg} viewBox="0 0 300 200" className={`es-art ${className}`}>
      <ellipse className="es-art__blob" cx="150" cy="112" rx="112" ry="72" />
      <ellipse className="es-art__blob es-art__floor" cx="160" cy="188" rx="96" ry="10" />
      <g transform="translate(96 30) rotate(-10)">
        <path className="es-art__stub" d={stub} />
        <g transform="translate(55 50) rotate(-40)">
          <path className="es-art__stubmark" d="M-22-12h44v7a5 5 0 0 0 0 10v7h-44v-7a5 5 0 0 0 0-10z" />
          <circle className="es-art__stubdot" r="4.5" />
        </g>
        <path className="es-art__stubline" d="M22 104H88M22 120H70" />
      </g>
      <Burst x={214} y={10} />
    </svg>
  );
}

/** A ticket with a QR code rising out of a printer — "sales at the door". */
export function DoorPrinterArt({ className = '' }) {
  const finder = (x, y) => (
    <g transform={`translate(${x} ${y})`}>
      <rect className="es-art__qrline" width="22" height="22" rx="3" />
      <rect className="es-art__qr" x="7" y="7" width="8" height="8" rx="1" />
    </g>
  );
  return (
    <svg {...svg} viewBox="0 0 320 220" className={`es-art ${className}`}>
      <path className="es-art__blob" d="M30 132c0-58 54-104 128-100s132 40 132 98-58 92-132 88S30 190 30 132z" />
      {/* Printer body, then the slot, then the ticket, then the lip over its foot */}
      <rect className="es-art__printer" x="70" y="132" width="196" height="76" rx="16" />
      <path className="es-art__printertop" d="M92 140H244L256 168H80Z" />
      <rect className="es-art__printerslot" x="116" y="126" width="104" height="14" rx="5" />
      <g transform="translate(124 8) rotate(7)">
        <rect className="es-art__qrcard" width="96" height="124" rx="8" />
        <path className="es-art__qrline" d="M14 12H82" />
        {finder(16, 26)}
        {finder(58, 26)}
        {finder(16, 68)}
        <path className="es-art__qr" d="M58 68h8v8h-8zM70 72h12v6H70zM62 82h6v8h-6zM74 84h8v8h-8zM44 30h6v12h-6zM44 74h6v6h-6zM30 54h12v6H30zM52 54h6v6h-6zM66 54h16v6H66z" />
      </g>
      <rect className="es-art__printer" x="108" y="134" width="120" height="10" rx="4" />
      <Burst x={258} y={2} />
    </svg>
  );
}

/** An invoice with a tick badge between two pairs of leaves — "no invoices". */
export function InvoiceArt({ className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 300 190" className={`es-art ${className}`}>
      <ellipse className="es-art__blob" cx="150" cy="178" rx="92" ry="8" />
      <path className="es-art__leaf es-art__leaf--light" d="M115 162C80 167 55 147 50 127C80 127 105 142 115 162Z" />
      <path className="es-art__leaf es-art__leaf--light" d="M185 162C220 167 245 147 250 127C220 127 195 142 185 162Z" />
      <path className="es-art__leaf" d="M120 152C72 142 60 102 80 80C100 100 120 122 120 152Z" />
      <path className="es-art__leaf" d="M180 152C228 142 240 102 220 80C200 100 180 122 180 152Z" />
      <g transform="translate(100 22) rotate(4)">
        <rect className="es-art__paper" width="100" height="138" rx="10" />
        <text className="es-art__papertitle" x="50" y="27" textAnchor="middle">INVOICE</text>
        <rect className="es-art__bar" x="14" y="42" width="48" height="6" rx="3" />
        <rect className="es-art__bar es-art__bar--soft" x="70" y="42" width="16" height="6" rx="3" />
        <rect className="es-art__bar" x="14" y="58" width="48" height="6" rx="3" />
        <rect className="es-art__bar es-art__bar--soft" x="70" y="58" width="16" height="6" rx="3" />
        <rect className="es-art__bar" x="14" y="74" width="40" height="6" rx="3" />
      </g>
      <circle className="es-art__badge" cx="194" cy="142" r="18" />
      <path className="es-art__badgetick" d="M185 142l6 6 11-12" />
      <Burst x={212} y={6} />
    </svg>
  );
}

/** Two tickets, the front one starred — "your first ticket type". */
export function TicketsArt({ className = '' }) {
  const ticket = 'M0 0h132a8 8 0 0 1 8 8v14a14 14 0 0 0 0 28v14a8 8 0 0 1-8 8H0a8 8 0 0 1-8-8V50a14 14 0 0 0 0-28V8a8 8 0 0 1 8-8z';
  return (
    <svg {...svg} viewBox="0 0 320 200" className={`es-art ${className}`}>
      <path className="es-art__blob" d="M60 112c0-50 46-86 108-84s116 30 116 82-54 78-116 76S60 162 60 112z" />
      <path className="es-art__card es-art__card--back es-art__outline" d={ticket} transform="translate(98 52) rotate(-10)" />
      <path className="es-art__ticket" d={ticket} transform="translate(122 84)" />
      <path className="es-art__star" d="M192 102l6.4 13 14.4 2.1-10.4 10.1 2.5 14.3-12.9-6.8-12.9 6.8 2.5-14.3-10.4-10.1 14.4-2.1z" />
      <Burst x={246} y={14} />
    </svg>
  );
}

