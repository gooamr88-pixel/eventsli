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
export function InvoiceArt({ className = '', badge = 'tick' }) {
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
      {/* `badge="percent"`: the admin's commission invoices, a % in a ring
          rather than the organizer's settled tick. */}
      {badge === 'percent' ? (
        <>
          <circle className="es-art__badgex" cx="194" cy="142" r="22" />
          <path className="es-art__xmark" d="M204 130 184 154" />
          <circle className="es-art__badgedot" cx="186" cy="134" r="4" />
          <circle className="es-art__badgedot" cx="202" cy="150" r="4" />
        </>
      ) : (
        <>
          <circle className="es-art__badge" cx="194" cy="142" r="18" />
          <path className="es-art__badgetick" d="M185 142l6 6 11-12" />
        </>
      )}
      <Burst x={212} y={6} />
    </svg>
  );
}

/** A QR ticket under a handheld scanner — "the door list". */
export function ScannerArt({ className = '' }) {
  const ticket = 'M8 0H142A8 8 0 0 1 150 8V28A12 12 0 0 0 150 52V72A8 8 0 0 1 142 80H8A8 8 0 0 1 0 72V52A12 12 0 0 0 0 28V8A8 8 0 0 1 8 0Z';
  const finder = (x, y) => (
    <g transform={`translate(${x} ${y})`}>
      <rect className="es-art__qrdark" width="22" height="22" rx="4" />
      <rect className="es-art__qrdot" x="7" y="7" width="8" height="8" rx="1.5" />
    </g>
  );
  return (
    <svg {...svg} viewBox="0 0 320 220" className={`es-art ${className}`}>
      <path className="es-art__blob" d="M24 130c0-56 52-100 124-96s140 34 140 92-56 94-128 90S24 186 24 130z" />
      <g transform="translate(56 82) rotate(-18)">
        <path className="es-art__scanticket" d={ticket} />
        {finder(46, 14)}
        {finder(76, 14)}
        {finder(46, 44)}
        <path className="es-art__qrdot" d="M76 44h8v8h-8zM90 50h8v8h-8zM78 58h6v8h-6z" />
      </g>
      <g transform="translate(192 66) rotate(12)">
        <path className="es-art__gungrip" d="M56 38H84L98 112Q100 124 88 126L74 128Q63 129 61 118Z" />
        <rect className="es-art__gun" width="112" height="48" rx="18" />
        <rect className="es-art__gunnose" x="-8" y="6" width="22" height="36" rx="8" />
        <path className="es-art__gunshine" d="M34 15H74" />
      </g>
      <Burst x={244} y={4} />
    </svg>
  );
}

/** Three guests, the middle one in front — "nobody on the list". */
export function PeopleArt({ className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 200 120" className={`es-art ${className}`}>
      <circle className="es-art__person" cx="62" cy="58" r="11" />
      <path className="es-art__person" d="M40 108a22 22 0 0 1 44 0Z" />
      <circle className="es-art__person" cx="138" cy="58" r="11" />
      <path className="es-art__person" d="M116 108a22 22 0 0 1 44 0Z" />
      <circle className="es-art__person es-art__person--front" cx="100" cy="42" r="14" />
      <path className="es-art__person es-art__person--front" d="M70 108a30 30 0 0 1 60 0Z" />
      <Burst x={150} y={0} />
    </svg>
  );
}

/** Scan corners framing a small QR, drawn at the origin; shared by the two below. */
function ScanFrame({ x, y, size }) {
  const c = size * 0.28;
  const s = size;
  return (
    <g transform={`translate(${x} ${y})`} className="es-art__frame">
      <path d={`M0 ${c}V4a4 4 0 0 1 4-4h${c - 4}M${s - c} 0h${c - 4}a4 4 0 0 1 4 4v${c - 4}M${s} ${s - c}v${c - 4}a4 4 0 0 1-4 4h-${c - 4}M${c} ${s}H4a4 4 0 0 1-4-4v-${c - 4}`} />
    </g>
  );
}

/** A phone scanning a QR, on two blobs — "scanning devices". */
export function PhoneScanArt({ className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 320 200" className={`es-art ${className}`}>
      <path className="es-art__blob" d="M40 120c0-48 50-84 116-82s128 26 128 74-52 80-118 78S40 168 40 120z" />
      <ellipse className="es-art__blob es-art__blob--deep" cx="212" cy="140" rx="64" ry="34" />
      <g transform="translate(150 12) rotate(10)">
        <rect className="es-art__device" width="92" height="164" rx="16" />
        <rect className="es-art__devicenotch" x="34" y="9" width="24" height="5" rx="2.5" />
        <ScanFrame x={20} y={44} size={52} />
        <path className="es-art__qrdot" d="M31 55h12v12H31zM49 55h12v12H49zM31 73h12v12H31zM49 73h12v12H49z" />
        <path className="es-art__devicebar" d="M34 148h24" />
      </g>
    </svg>
  );
}

/** A tablet tilted on two leaves of colour, with scan corners — "no devices yet". */
export function TabletArt({ className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 280 160" className={`es-art ${className}`}>
      <ellipse className="es-art__blob" cx="80" cy="110" rx="62" ry="38" />
      <ellipse className="es-art__blob es-art__blob--deep" cx="208" cy="100" rx="54" ry="34" />
      <g transform="translate(70 40) rotate(-8)">
        <rect className="es-art__device" width="146" height="100" rx="14" />
        <ScanFrame x={50} y={27} size={46} />
      </g>
      <Burst x={224} y={0} />
    </svg>
  );
}

const TICKET_WIDE = 'M10 0H160A10 10 0 0 1 170 10V33A12 12 0 0 0 170 57V80A10 10 0 0 1 160 90H10A10 10 0 0 1 0 80V57A12 12 0 0 0 0 33V10A10 10 0 0 1 10 0Z';
const STAR = 'M0-14 3.5-4.9 13.3-4.3 5.7 1.9 8.2 11.3 0 6-8.2 11.3-5.7 1.9-13.3-4.3-3.5-4.9Z';

/** Soft clouds under a picture; shared by the account empty states. */
function Clouds() {
  return (
    <>
      <ellipse className="es-art__blob" cx="110" cy="152" rx="82" ry="38" />
      <ellipse className="es-art__blob" cx="214" cy="146" rx="88" ry="44" />
      <circle className="es-art__blob es-art__blob--deep" cx="165" cy="108" r="54" />
    </>
  );
}

/** A starred ticket with a QR code, another behind it — "no tickets yet". */
export function TicketQrArt({ className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 320 200" className={`es-art ${className}`}>
      <Clouds />
      <path className="es-art__ticketback" d={TICKET_WIDE} transform="translate(120 66) rotate(-14)" />
      <g transform="translate(80 72) rotate(-14)">
        <path className="es-art__ticketfront" d={TICKET_WIDE} />
        <circle className="es-art__ticketspot" cx="50" cy="45" r="24" />
        <path className="es-art__ticketstar" d={STAR} transform="translate(50 46)" />
        <path className="es-art__ticketperf" d="M88 12V78" />
        <circle className="es-art__ticketspot" cx="126" cy="45" r="26" />
        <g className="es-art__ticketqr">
          <rect x="113" y="32" width="10" height="10" rx="2" />
          <rect x="129" y="32" width="10" height="10" rx="2" />
          <rect x="113" y="48" width="10" height="10" rx="2" />
          <path d="M130 49h4v4h-4zM135 54h4v4h-4z" />
        </g>
      </g>
      <Burst x={252} y={0} />
    </svg>
  );
}

/** A receipt with a cart on it and a torn edge — "no orders yet". */
export function ReceiptArt({ className = '' }) {
  const hem = 'q-7.75 10-15.5 0'.repeat(8);
  return (
    <svg {...svg} viewBox="0 0 320 200" className={`es-art ${className}`}>
      <Clouds />
      <g transform="translate(110 30) rotate(6)">
        <path className="es-art__receipt" d={`M12 0H124V140${hem}V12A12 12 0 0 1 12 0Z`} />
        <path className="es-art__receiptcurl" d="M112 0h14a14 14 0 0 1 0 28h-14z" />
        <path className="es-art__receiptcart" d="M3 4h2.5l2.2 11h10.6l2-8H6.6M9.5 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" transform="translate(46 16) scale(1.5)" />
        <rect className="es-art__bar" x="22" y="62" width="56" height="6" rx="3" />
        <rect className="es-art__bar es-art__bar--soft" x="88" y="62" width="14" height="6" rx="3" />
        <rect className="es-art__bar" x="22" y="80" width="46" height="6" rx="3" />
        <rect className="es-art__bar es-art__bar--soft" x="88" y="80" width="14" height="6" rx="3" />
        <rect className="es-art__bar" x="22" y="98" width="40" height="6" rx="3" />
      </g>
      <Burst x={246} y={2} />
    </svg>
  );
}

/** A shield with a tick, on clouds — "keep your account secure". */
export function ShieldArt({ className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 260 170" className={`es-art ${className}`}>
      <ellipse className="es-art__blob" cx="92" cy="122" rx="62" ry="30" />
      <ellipse className="es-art__blob" cx="172" cy="118" rx="66" ry="34" />
      <path className="es-art__shield" d="M130 16 180 34V76c0 36-22 58-50 72-28-14-50-36-50-72V34Z" />
      <path className="es-art__shieldtick" d="M108 80l15 15 29-31" />
      <Burst x={190} y={4} />
    </svg>
  );
}

/** A ticked clipboard under a magnifying glass — "nothing waiting for review". */
export function ClipboardArt({ className = '' }) {
  const row = (y) => (
    <g key={y}>
      <rect className="es-art__checkbox" x="16" y={y} width="18" height="18" rx="4" />
      <path className="es-art__checktick" d={`M20 ${y + 9}l4 4 7-8`} />
      <rect className="es-art__bar" x="44" y={y + 2} width="50" height="5" rx="2.5" />
      <rect className="es-art__bar es-art__bar--soft" x="44" y={y + 11} width="34" height="5" rx="2.5" />
    </g>
  );
  return (
    <svg {...svg} viewBox="0 0 320 200" className={`es-art ${className}`}>
      <Clouds />
      <g transform="translate(116 26) rotate(-6)">
        <rect className="es-art__paper" width="110" height="150" rx="12" />
        <rect className="es-art__clip" x="35" y="-10" width="40" height="18" rx="6" />
        <circle className="es-art__paper" cx="55" cy="-6" r="3.5" />
        {[32, 66, 100].map(row)}
      </g>
      <circle className="es-art__lens" cx="224" cy="130" r="26" />
      <path className="es-art__lenshandle" d="M243 149l18 18" />
      <Burst x={236} y={0} />
    </svg>
  );
}

/** A calendar with a cross badge — "no cancellation requests". */
export function CalendarXArt({ className = '' }) {
  return (
    <svg {...svg} viewBox="0 0 320 200" className={`es-art ${className}`}>
      <Clouds />
      <rect className="es-art__paper" x="104" y="40" width="122" height="112" rx="14" />
      <path className="es-art__calline" d="M104 70H226" />
      <rect className="es-art__ring" x="128" y="28" width="10" height="24" rx="5" />
      <rect className="es-art__ring" x="192" y="28" width="10" height="24" rx="5" />
      {[122, 152, 182].map((x) => [84, 112].map((y) => (
        <rect key={`${x}-${y}`} className="es-art__cell" x={x} y={y} width="20" height="18" rx="4" />
      )))}
      <circle className="es-art__badgex" cx="224" cy="142" r="28" />
      <path className="es-art__xmark" d="M212 130l24 24M236 130l-24 24" />
      <Burst x={238} y={4} />
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

