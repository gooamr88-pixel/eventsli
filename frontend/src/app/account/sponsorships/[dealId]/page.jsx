import SponsorDeal from './SponsorDeal';

export const metadata = {
  title: 'Sponsorship',
  robots: { index: false, follow: false },
};

/** One sponsorship, from the sponsor's side (2026-11-20). */
export default async function SponsorDealPage({ params }) {
  const { dealId } = await params;
  return <SponsorDeal dealId={dealId} />;
}
