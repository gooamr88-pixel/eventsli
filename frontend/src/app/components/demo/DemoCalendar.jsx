'use client';

import NavIcon from '../shell/NavIcon';
import { monthGrid, monthTitle } from '../../lib/demoTime';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The month on the "Book a demo" card. A day with at least one open time is
 * a button; every other day is plain text. `today` is outlined.
 */
export default function DemoCalendar({ view, onMonth, canBack, canForward, openDays, today, selected, onPick, loading }) {
  const weeks = monthGrid(view.year, view.month);
  const title = monthTitle(view.year, view.month);
  return (
    <div className="es-demo-cal" aria-busy={loading || undefined}>
      <div className="es-demo-cal__head">
        <button type="button" className="es-demo-cal__nav" onClick={() => onMonth(-1)} disabled={!canBack} aria-label="Previous month">
          <NavIcon name="chevronLeft" size={20} />
        </button>
        <p className="es-demo-cal__title" aria-live="polite">{title}</p>
        <button type="button" className="es-demo-cal__nav" onClick={() => onMonth(1)} disabled={!canForward} aria-label="Next month">
          <NavIcon name="chevronRight" size={20} />
        </button>
      </div>
      <table className="es-demo-cal__grid" aria-label={title}>
        <thead>
          <tr>{WEEKDAYS.map((d) => <th key={d} scope="col" abbr={d}>{d}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((date, j) => {
                if (!date) return <td key={j} />;
                const day = Number(date.slice(8));
                const open = Boolean(openDays[date]);
                const cls = `es-demo-cal__day${open ? ' is-open' : ''}${date === selected ? ' is-on' : ''}${date === today ? ' is-today' : ''}`;
                return (
                  <td key={j}>
                    {open ? (
                      <button
                        type="button"
                        className={cls}
                        onClick={() => onPick(date)}
                        aria-pressed={date === selected}
                        aria-label={`${day} ${title}, ${openDays[date]} open time${openDays[date] === 1 ? '' : 's'}`}
                      >
                        {day}
                      </button>
                    ) : (
                      <span className={cls} aria-disabled="true">{day}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && Object.keys(openDays).length === 0 && (
        <p className="es-demo-cal__none">No open times this month. Try the next one.</p>
      )}
    </div>
  );
}
