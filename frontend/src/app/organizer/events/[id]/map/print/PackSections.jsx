'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The pack's written sections: the table index, the zone list and the cards.
 *
 * All three are plain flowing HTML, and every row carries
 * `break-inside: avoid`. That is what keeps a table's entry from being cut in
 * half by a page edge — the failure that makes a printed roster untrustworthy,
 * because the reader cannot tell whether the half-row at the bottom is the same
 * table as the half-row overleaf.
 *
 * ONE INK here too. Styling is inline rather than in classes because this
 * subtree is printed: a print stylesheet that depends on the app's cascade is a
 * stylesheet that behaves differently in the print renderer than it did on
 * screen, and the one place you cannot check the result is the sheet coming out
 * of somebody else's printer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const INK = '#101215';
const RULE = '1px solid rgba(16,18,21,0.18)';

const cell = { padding: '2.2mm 2mm', textAlign: 'left', verticalAlign: 'top' };
const head = {
  ...cell,
  fontSize: '3mm',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderBottom: `1.4px solid ${INK}`,
};

export function SectionHeading({ title, note }) {
  return (
    <header style={{ marginBottom: '4mm' }}>
      <h2 style={{ fontSize: '5.2mm', fontWeight: 700, color: INK, margin: 0 }}>{title}</h2>
      {note && <p style={{ fontSize: '3.1mm', color: INK, opacity: 0.7, margin: '1mm 0 0' }}>{note}</p>}
    </header>
  );
}

/**
 * Every table, by name.
 *
 * The free-seat column is the one somebody actually uses at the door, so it is
 * last — the place a finger lands after tracking across a row — and it is the
 * only number set in bold.
 */
export function TableIndex({ rows }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '3.3mm', color: INK }}>
      <thead>
        <tr>
          <th style={head}>Table</th>
          <th style={head}>Shape</th>
          <th style={head}>Seats</th>
          <th style={head}>Taken</th>
          <th style={head}>Free</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} style={{ borderBottom: RULE, breakInside: 'avoid' }}>
            <td style={{ ...cell, fontWeight: 700 }}>
              {row.label}
              {row.isPrivate && <span style={{ fontWeight: 400, opacity: 0.7 }}> · private</span>}
              {row.unsaved && <span style={{ fontWeight: 400, opacity: 0.7 }}> · not saved</span>}
              {row.category && (
                <span style={{ display: 'block', fontWeight: 400, fontSize: '2.9mm', opacity: 0.7 }}>
                  {row.category}
                </span>
              )}
            </td>
            <td style={cell}>{row.shape}</td>
            <td style={cell}>{row.seats}</td>
            <td style={cell}>{row.sold}</td>
            <td style={{ ...cell, fontWeight: 700 }}>{row.free}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The furniture, for whoever is setting the room up before anyone arrives. */
export function ZoneIndex({ rows }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '3.3mm', color: INK }}>
      <thead>
        <tr>
          <th style={head}>Area</th>
          <th style={head}>Type</th>
          <th style={head}>Size</th>
          <th style={head}>Turned</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} style={{ borderBottom: RULE, breakInside: 'avoid' }}>
            <td style={{ ...cell, fontWeight: 700 }}>{row.label}</td>
            <td style={cell}>{row.kind}</td>
            <td style={cell}>{row.width}&thinsp;×&thinsp;{row.height}</td>
            <td style={cell}>{row.rotation}°</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One card per table, to cut out and stand on the table itself.
 *
 * Set very large, because it is read from standing height by someone walking
 * between tables looking for their own. Everything else on the card is a
 * whisper next to the name — the seat count is there only so the person laying
 * out place settings knows how many to put down.
 */
export function TableCards({ rows, columns = 2, rowsPerPage = 3 }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gridAutoRows: `${Math.floor(100 / rowsPerPage)}%`,
        gap: '4mm',
        height: '100%',
      }}
    >
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            border: `1.4px dashed rgba(16,18,21,0.45)`,
            borderRadius: '2mm',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4mm',
            breakInside: 'avoid',
            color: INK,
            textAlign: 'center',
            minHeight: 0,
          }}
        >
          <span style={{ fontSize: '16mm', fontWeight: 800, lineHeight: 1.05 }}>{row.label}</span>
          <span style={{ fontSize: '3.4mm', opacity: 0.75, marginTop: '2mm' }}>
            {row.seats} {row.seats === 1 ? 'seat' : 'seats'}
          </span>
        </div>
      ))}
    </div>
  );
}
