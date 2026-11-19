import NavIcon from '../components/shell/NavIcon';
import DemoBooker from '../components/demo/DemoBooker';
import { CONTACT_EMAIL } from '../lib/siteRoutes';
import { hostCalendar } from '../lib/demoTime';
import { loadDemoSettings, DemoUnavailable } from '../components/demo/demoPageParts';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Book a demo (owner, 2026-11-19) — the reference's layout in our brand: the
 * pitch and the contact lines on the left, the booking card on the right
 * (stacked on a phone).
 *
 * Everything on it is the admin's: Admin › Demo bookings › Settings. "Today"
 * and the booking horizon are worked out HERE, on the host's clock, so the
 * card never reads the clock while it renders.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const metadata = {
  title: 'Book a demo',
  description: 'See Eventsli on your own event — seat maps, ticket types, door check-in and payouts — live with our team.',
  alternates: { canonical: '/demo' },
};

export default async function DemoPage() {
  const settings = await loadDemoSettings();
  const email = settings?.contactEmail || CONTACT_EMAIL;

  return (
    <main className="fx-gutter">
      <div className="fx-container fx-container--xl es-demo">
        <div className="es-demo__pitch">
          <h1 className="es-demo__title">{settings?.title || 'Book a demo'}</h1>
          {settings?.intro && <p className="es-demo__intro">{settings.intro}</p>}
          <h2 className="es-demo__contact-title">Contact information</h2>
          <ul className="es-demo__contact">
            {settings?.contactPhone && (
              <li>
                <a href={`tel:${settings.contactPhone.replace(/[^0-9+]/g, '')}`}>
                  <NavIcon name="phone" size={20} /> {settings.contactPhone}
                </a>
              </li>
            )}
            <li>
              <a href={`mailto:${email}`}><NavIcon name="mail" size={20} /> {email}</a>
            </li>
          </ul>
        </div>

        <div className="es-demo__booker">
          {settings?.enabled
            ? <DemoBooker settings={settings} {...hostCalendar(settings)} />
            : <DemoUnavailable settings={settings} email={email} />}
        </div>
      </div>
    </main>
  );
}
