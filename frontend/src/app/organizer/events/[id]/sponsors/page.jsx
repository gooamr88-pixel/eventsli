import Sponsors from './Sponsors';

export const metadata = {
  title: 'Sponsors',
  robots: { index: false, follow: false },
};

/** The event's sponsorship desk (2026-11-20). */
export default async function SponsorsPage({ params }) {
  const { id } = await params;
  return <Sponsors eventId={id} />;
}
