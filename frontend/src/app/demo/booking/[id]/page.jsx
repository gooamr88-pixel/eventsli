import ManageDemo from '../../../components/demo/ManageDemo';
import { loadDemoSettings, DemoUnavailable } from '../../../components/demo/demoPageParts';
import { hostCalendar } from '../../../lib/demoTime';
import { CONTACT_EMAIL } from '../../../lib/siteRoutes';

/**
 * The booker's own "change or cancel" page, from the link in their emails.
 * The token in `?t=` is the only key: no sign-in. Never indexed (siteRoutes
 * PRIVATE_PREFIXES: the URL is a bearer link).
 */
export const metadata = {
  title: 'Your demo booking',
  robots: { index: false, follow: false },
};

export default async function ManageDemoPage({ params, searchParams }) {
  const { id } = await params;
  const { t } = await searchParams;
  const settings = await loadDemoSettings();
  const email = settings?.contactEmail || CONTACT_EMAIL;
  return (
    <main className="fx-gutter">
      <div className="fx-container fx-container--sm es-demo-manage">
        {settings
          ? <ManageDemo id={id} token={typeof t === 'string' ? t : ''} settings={settings} email={email} {...hostCalendar(settings)} />
          : <DemoUnavailable settings={null} email={email} />}
      </div>
    </main>
  );
}
