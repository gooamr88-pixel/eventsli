/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One table component for every list in the dashboard and the console.
 *
 *   <DataTable
 *     caption="Orders"
 *     rows={orders}
 *     columns={[
 *       { key: 'buyer', label: 'Buyer', primary: true, render: (o) => o.buyer.name },
 *       { key: 'total', label: 'Total', align: 'end', render: (o) => formatMoney(...) },
 *     ]}
 *   />
 *
 * A desktop gets a real <table> — columns line up, a screen reader can move by
 * cell and hear the header. A phone gets the SAME markup restyled as a stack of
 * cards (see .es-table--stack), each cell labelled from `label`. The alternative
 * everyone reaches for, a table that scrolls sideways, hides every column but
 * the first behind a gesture most people never try.
 *
 * `primary` marks the column that becomes the card's heading on a phone.
 *
 * No loading or empty state inside: those are the page's to say (Feedback.jsx),
 * because only the page knows WHY a list is empty and what to do about it.
 * A server component — it renders what it is given and holds no state.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function DataTable({ columns, rows, rowKey = (row) => row.id, caption, stack = true }) {
  return (
    <div className="es-table-wrap">
      <table className={`es-table ${stack ? 'es-table--stack' : ''}`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" data-align={col.align}>
                {col.hideLabel ? <span className="sr-only">{col.label}</span> : col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  data-label={col.hideLabel ? undefined : col.label}
                  data-align={col.align}
                  data-primary={col.primary ? '' : undefined}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
