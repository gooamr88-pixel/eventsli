/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The printed sales report's stylesheet (OrdersReport.jsx, 2026-11-23).
 *
 * SCOPED TO THE MODAL, as the seating pack's is (map/print/SeatingPackModal):
 * one of these rules hides the whole application for printing, and a rule that
 * can do that must not outlive the dialog that needs it. Mounted with it, gone
 * when it closes.
 *
 * The page is PAPER, so its colours are fixed hex rather than theme tokens: a
 * report printed from dark mode is still black ink on white. `print-color-
 * adjust: exact` keeps the brand band, the KPI washes and the zebra rows, which
 * browsers otherwise drop to save toner.
 *
 * Unlike the seating pack, this document FLOWS: an order list has no natural
 * page, so the browser paginates it, the table header repeats on every page
 * (`table-header-group`), and no row is split across two. The page number and
 * the event's name go in the `@page` margin boxes, which Chrome and Edge print
 * and other browsers simply leave blank.
 *
 * No `!important` (the project's check refuses them): the print rules come
 * later in the same sheet at the same specificity, and win by order.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A string safe inside a CSS `content: "…"`. */
const cssString = (s) => `"${String(s || '').replace(/[\\"]/g, '\\$&').replace(/[\n\r]+/g, ' ').slice(0, 90)}"`;

export function reportCss({ box, footer }) {
  return `
    .es-orep-root {
      position: fixed; inset: 0; z-index: var(--es-z-modal);
      display: flex; flex-direction: column; background: var(--es-scrim);
    }
    .es-orep-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 24px 12px 48px; }
    .es-orep-sheet {
      width: ${box.width}mm; max-width: 100%; margin: 0 auto; padding: 14mm 13mm 16mm;
      box-sizing: border-box; background: #fff; color: #15141c;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.28); border-radius: 2px;
      font-family: var(--es-font-sans); font-size: 3.1mm; line-height: 1.45;
      --es-logo-mark: #ffcc00; --es-logo-initial: #15141c; --es-logo-ink: #ffffff; --es-logo-li: #ffffff;
    }
    .es-orep-sheet * { box-sizing: border-box; }
    .es-orep-num { font-variant-numeric: tabular-nums; }

    /* ── The brand band ── */
    .es-orep-band {
      display: flex; align-items: center; justify-content: space-between; gap: 6mm;
      background: #15141c; color: #fff; border-radius: 3mm; padding: 5mm 6mm;
      border-bottom: 1.6mm solid #d61f2c;
    }
    .es-orep-band .es-logo { --es-logo-h: 8mm; }
    .es-orep-band__tag { text-align: right; }
    .es-orep-band__eyebrow {
      margin: 0; color: #ffcc00; font-weight: 700; font-size: 2.6mm; letter-spacing: 0.22em;
    }
    .es-orep-band__date { margin: 0.8mm 0 0; font-size: 2.7mm; color: #c9c8d6; }

    /* ── The event ── */
    .es-orep-event { margin: 8mm 0 6mm; }
    .es-orep-event__title {
      margin: 0; font-family: var(--es-font-display); font-weight: 800; font-size: 8.4mm;
      line-height: 1.12; letter-spacing: -0.01em; color: #15141c;
    }
    .es-orep-event__line { margin: 1.6mm 0 0; color: #5d5c6b; font-size: 3.3mm; }
    .es-orep-chips { display: flex; flex-wrap: wrap; gap: 1.6mm; margin-top: 3.2mm; }
    .es-orep-chip {
      border: 0.3mm solid #e2e1e8; border-radius: 99mm; padding: 0.7mm 2.6mm;
      font-size: 2.6mm; font-weight: 600; color: #3b3a48; background: #fafafb;
    }
    .es-orep-chip--accent { border-color: #ffc2c6; background: #fff1f2; color: #b5121e; }

    /* ── Section headings ── */
    .es-orep-h2 {
      display: flex; align-items: baseline; justify-content: space-between; gap: 4mm;
      margin: 7mm 0 3.2mm; padding-bottom: 1.6mm; border-bottom: 0.5mm solid #15141c;
      break-after: avoid;
    }
    .es-orep-h2 h2 { margin: 0; font-family: var(--es-font-display); font-size: 4.6mm; font-weight: 800; }
    .es-orep-h2 span { font-size: 2.7mm; color: #6b6a7a; }

    /* ── KPI tiles ── */
    .es-orep-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2.6mm; break-inside: avoid; }
    .es-orep-kpi {
      border-radius: 2.4mm; padding: 3.4mm 3.6mm; background: #f5f5f8; border: 0.3mm solid #ebeaf0;
      min-width: 0;
    }
    .es-orep-kpi--accent { background: #fff1f2; border-color: #ffc2c6; }
    .es-orep-kpi__label {
      margin: 0; font-size: 2.3mm; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b6a7a;
    }
    .es-orep-kpi--accent .es-orep-kpi__label { color: #b5121e; }
    .es-orep-kpi__value {
      margin: 1.4mm 0 0; font-family: var(--es-font-display); font-weight: 800; font-size: 6mm;
      line-height: 1.1; color: #15141c; overflow-wrap: anywhere;
    }
    .es-orep-kpi--accent .es-orep-kpi__value { color: #d61f2c; }
    .es-orep-kpi__note { margin: 1mm 0 0; font-size: 2.4mm; color: #6b6a7a; }

    /* ── Breakdown + channel split ── */
    .es-orep-split { display: grid; grid-template-columns: 1.25fr 1fr; gap: 6mm; margin-top: 5mm; break-inside: avoid; }
    .es-orep-sub { margin: 0 0 2mm; font-size: 2.5mm; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b6a7a; }
    .es-orep-ledger { width: 100%; border-collapse: collapse; font-size: 3mm; }
    .es-orep-ledger td { padding: 1.5mm 0; border-bottom: 0.25mm solid #ebeaf0; }
    .es-orep-ledger td:last-child { text-align: right; }
    .es-orep-ledger .is-total td { border-top: 0.4mm solid #15141c; font-weight: 700; }
    .es-orep-ledger .is-net td {
      font-weight: 800; color: #b5121e; background: #fff1f2; border-bottom: none; padding: 2mm 2mm;
    }
    .es-orep-ledger .is-minus td:last-child { color: #5d5c6b; }

    .es-orep-bar { display: flex; height: 4mm; border-radius: 99mm; overflow: hidden; background: #ebeaf0; margin: 1mm 0 3mm; }
    .es-orep-bar span { display: block; height: 100%; }
    .es-orep-bar .is-card { background: #d61f2c; }
    .es-orep-bar .is-door { background: #ffcc00; }
    .es-orep-legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.8mm; font-size: 2.9mm; }
    .es-orep-legend li { display: grid; grid-template-columns: 3mm 1fr auto; align-items: center; gap: 2mm; }
    .es-orep-dot { width: 2.6mm; height: 2.6mm; border-radius: 50%; }
    .es-orep-dot.is-card { background: #d61f2c; }
    .es-orep-dot.is-door { background: #ffcc00; }
    .es-orep-legend small { display: block; color: #6b6a7a; font-size: 2.4mm; }
    .es-orep-hosts { margin-top: 4mm; }

    /* ── The order table ── */
    .es-orep-table { width: 100%; border-collapse: collapse; font-size: 2.75mm; }
    .es-orep-table thead { display: table-header-group; }
    .es-orep-table th {
      text-align: left; font-size: 2.2mm; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
      color: #fff; background: #15141c; padding: 2.2mm 2mm;
    }
    .es-orep-table th:first-child { border-radius: 1.6mm 0 0 1.6mm; }
    .es-orep-table th:last-child { border-radius: 0 1.6mm 1.6mm 0; }
    .es-orep-table td { padding: 2mm; border-bottom: 0.25mm solid #ebeaf0; vertical-align: top; }
    .es-orep-table tbody tr { break-inside: avoid; }
    .es-orep-table tbody tr:nth-child(even) td { background: #fafafb; }
    .es-orep-table .is-end { text-align: right; white-space: nowrap; }
    .es-orep-table .is-muted { color: #6b6a7a; }
    .es-orep-table .is-ref { font-family: var(--es-font-code); font-size: 2.5mm; color: #5d5c6b; }
    .es-orep-table .is-net { font-weight: 700; color: #b5121e; }
    .es-orep-buyer { font-weight: 700; color: #15141c; overflow-wrap: anywhere; }
    .es-orep-email { display: block; color: #6b6a7a; font-size: 2.5mm; overflow-wrap: anywhere; }
    .es-orep-pill {
      display: inline-block; padding: 0.4mm 2mm; border-radius: 99mm; font-size: 2.3mm; font-weight: 700;
      white-space: nowrap; background: #fff1f2; color: #b5121e;
    }
    .es-orep-pill.is-door { background: #fff6cc; color: #6b5300; }
    .es-orep-pill.is-guest { background: #f0eff5; color: #3b3a48; }
    .es-orep-table tr.is-total td {
      background: #15141c; color: #fff; font-weight: 800; border: none; font-size: 3mm;
    }
    .es-orep-table tr.is-total td.is-net { color: #ffcc00; }
    .es-orep-empty { padding: 10mm 0; text-align: center; color: #6b6a7a; }

    .es-orep-foot {
      margin-top: 7mm; padding-top: 3mm; border-top: 0.3mm solid #e2e1e8;
      display: flex; justify-content: space-between; gap: 6mm; font-size: 2.4mm; color: #6b6a7a;
    }
    .es-orep-foot p { margin: 0; max-width: 125mm; }

    @media print {
      @page {
        size: ${box.width}mm ${box.height}mm;
        margin: 11mm 10mm 14mm;
        @bottom-left { content: ${cssString(footer)}; font-family: sans-serif; font-size: 7.5pt; color: #8a8998; }
        @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: sans-serif; font-size: 7.5pt; color: #8a8998; }
      }
      body > *:not(.es-orep-root) { display: none; }
      .es-orep-root { position: static; inset: auto; display: block; background: #fff; }
      .es-orep-root .es-orep-chrome { display: none; }
      .es-orep-root .es-orep-scroll { overflow: visible; padding: 0; }
      .es-orep-root .es-orep-sheet { width: auto; max-width: none; padding: 0; margin: 0; box-shadow: none; border-radius: 0; }
      * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  `;
}
