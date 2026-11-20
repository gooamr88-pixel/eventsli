import DealDetail from './DealDetail';

export const metadata = {
  title: 'Sponsorship',
  robots: { index: false, follow: false },
};

/** One sponsorship deal (2026-11-20). */
export default async function DealPage({ params }) {
  const { id, dealId } = await params;
  return <DealDetail eventId={id} dealId={dealId} />;
}
