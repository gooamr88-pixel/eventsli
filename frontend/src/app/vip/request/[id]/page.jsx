import VisitorRequest from './VisitorRequest';

/**
 * A visitor's own VIP request (2026-11-28), from the private link in their
 * emails. The token in `?t=` is the only key: no sign-in. Never indexed
 * (siteRoutes PRIVATE_PREFIXES: the URL is a bearer link).
 */
export const metadata = {
  title: 'Your VIP request',
  robots: { index: false, follow: false },
};

export default async function VisitorRequestPage({ params, searchParams }) {
  const { id } = await params;
  const { t } = await searchParams;
  return (
    <main className="fx-gutter fx-section fx-section--sm">
      <div className="fx-container fx-container--xl">
        <VisitorRequest id={id} token={typeof t === 'string' ? t : ''} />
      </div>
    </main>
  );
}
