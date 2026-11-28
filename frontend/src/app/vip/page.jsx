import { serverFetch } from '../utils/apiClient';
import { CONTACT_EMAIL } from '../lib/siteRoutes';
import VipLanding from '../components/vip/VipLanding';
import VipRequestForm from '../organizer/vip/new/VipRequestForm';
import NavIcon from '../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services for every visitor (owner, 2026-11-28: "make this available
 * also for all visitors").
 *
 * The same front door as the organizer dashboard's (components/vip/
 * VipLanding), rendered on the server so it reads instantly and is indexed,
 * and the request form further down the page, open to anyone: no account.
 * A visitor's request comes back with a private link to follow it.
 *
 * The offer is the super admin's (Admin › VIP Services › Settings), cached
 * for a minute. If the API cannot be reached, the page still shows the
 * team's number and email: nobody is turned away by an outage.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const metadata = {
  title: 'VIP Services',
  description: 'The Eventsli team, on your event: full setup, seat maps, marketing, door teams, VIP hospitality, sponsors and vendors. Plan it with us on WhatsApp.',
  alternates: { canonical: '/vip' },
};

const FALLBACK = {
  enabled: false,
  whatsappNumber: '+16196666620',
  email: CONTACT_EMAIL,
  responseTime: '',
  services: [],
};

async function loadOffer() {
  try {
    return await serverFetch('/public/vip', { revalidate: 60 });
  } catch {
    return null;
  }
}

export default async function VipPage() {
  const offer = await loadOffer();
  const settings = offer?.settings || FALLBACK;
  const chatUrl = offer?.chatUrl || `https://wa.me/${FALLBACK.whatsappNumber.slice(1)}`;

  return (
    <main className="fx-gutter fx-section fx-section--sm">
      <div className="fx-container fx-container--xl">
        <VipLanding settings={settings} chatUrl={chatUrl} cta={{ href: '#request', label: 'Start a request' }}>
          {!offer && (
            <p className="es-vippublic__down">
              <NavIcon name="alert" size={18} /> We could not load the request form just now. Message us on WhatsApp or email {settings.email}, and we will help.
            </p>
          )}
        </VipLanding>

        {offer && settings.enabled && (
          <section id="request" className="es-vippublic__form" aria-label="Start a VIP request">
            <VipRequestForm mode="visitor" />
          </section>
        )}
      </div>
    </main>
  );
}
