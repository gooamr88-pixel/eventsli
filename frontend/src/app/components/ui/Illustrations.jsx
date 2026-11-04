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
