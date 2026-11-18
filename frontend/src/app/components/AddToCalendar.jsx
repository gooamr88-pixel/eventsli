'use client';

import { useCallback } from 'react';
import NavIcon from './shell/NavIcon';
import { googleCalendarUrl, outlookCalendarUrl, icsFile, icsFilename } from '../lib/calendar';
import { siteOrigin } from '../lib/eventSeo';

/**
 * "Add to calendar" on a bought ticket (owner, 2026-11-18): Google, Outlook,
 * and an .ics file for Apple Calendar and everything else. See lib/calendar.js.
 *
 * The .ics is made in the browser — the event's facts are already on the
 * page — so there is no endpoint, no token in a URL, and it works offline.
 */
export default function AddToCalendar({ event, className = '' }) {
  // The site's own origin, not window.location: the same on the server and in
  // the browser, so the links hydrate without a mismatch.
  const pageUrl = event?.slug ? `${siteOrigin()}/e/${event.slug}` : null;
  const google = googleCalendarUrl(event, pageUrl);
  const outlook = outlookCalendarUrl(event, pageUrl);

  const download = useCallback(() => {
    const body = icsFile(event, pageUrl);
    if (!body) return;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = icsFilename(event);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [event, pageUrl]);

  if (!google) return null;

  return (
    <section className={`es-cal ${className}`} aria-labelledby="add-to-calendar">
      <h2 id="add-to-calendar" className="es-cal__title">
        <NavIcon name="calendar" size={18} /> Add to your calendar
      </h2>
      <div className="es-cal__row">
        <a className="es-cal__btn" href={google} target="_blank" rel="noopener noreferrer">Google Calendar</a>
        <button type="button" className="es-cal__btn" onClick={download}>Apple Calendar</button>
        <a className="es-cal__btn" href={outlook} target="_blank" rel="noopener noreferrer">Outlook</a>
        <button type="button" className="es-cal__btn es-cal__btn--quiet" onClick={download}>
          <NavIcon name="download" size={14} /> .ics file
        </button>
      </div>
      <p className="es-cal__note">With a reminder the day before.</p>
    </section>
  );
}
