import { serverFetch } from '../../utils/apiClient';

/** The public demo settings, cached a minute and dropped on an admin save ("demo" tag). Null when the API is down. */
export async function loadDemoSettings() {
  try {
    return await serverFetch('/public/demo', { tags: ['demo'], revalidate: 60 });
  } catch {
    return null;
  }
}

/** The card's place when bookings are off, or the settings could not load. Says who failed. */
export function DemoUnavailable({ settings, email }) {
  return (
    <section className="es-demo-card">
      <h2 className="es-demo-card__title">{settings ? 'Demo bookings are paused' : 'We could not load the calendar just now'}</h2>
      <p className="es-demo-card__sub">
        {settings ? 'Email' : 'Please try again in a moment, or email'} us at <a href={`mailto:${email}`}>{email}</a> and we will find a time with you.
      </p>
    </section>
  );
}
