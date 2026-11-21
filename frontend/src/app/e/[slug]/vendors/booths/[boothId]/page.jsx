import { notFound } from 'next/navigation';
import { serverFetch } from '../../../../../utils/apiClient';
import BoothDetail from './BoothDetail';

/**
 * ONE BOOTH (owner's reference, 2026-11-21): its photo and what it includes,
 * then "Booth Services" — the booth add-ons and the marketing add-ons — and
 * the total, with Reserve (instant) or Apply (apply). Read from the same
 * public vendor page the list comes from, so the two never disagree.
 */
export const revalidate = 60;

async function load(slug) {
  try {
    return await serverFetch(`/public/events/${encodeURIComponent(slug)}/vendors`, { tags: [`event:${slug}`], revalidate: 60 });
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function generateMetadata({ params }) {
  const { slug, boothId } = await params;
  const page = await load(slug);
  const booth = page?.booths.find((b) => b.id === boothId);
  if (!booth) return { title: 'Booth', robots: { index: false, follow: false } };
  return { title: `${booth.name} · ${page.event.title}`, description: booth.description?.slice(0, 160) || `A vendor booth at ${page.event.title}.` };
}

export default async function BoothPage({ params }) {
  const { slug, boothId } = await params;
  const page = await load(slug);
  const booth = page?.booths.find((b) => b.id === boothId);
  if (!booth) notFound();
  // Only this booth type's spots on the floor plan can be picked here.
  const spots = page.floorPlan
    ? page.floorPlan.plan.elements.filter((e) => e.kind === 'booth' && e.boothTypeId === booth.id).map((e) => e.id)
    : [];
  return (
    <BoothDetail
      event={page.event}
      booth={booth}
      addons={page.addons || []}
      mode={page.bookingMode === 'instant' ? 'instant' : 'apply'}
      open={page.acceptingApplications}
      holdMinutes={page.holdMinutes || 20}
      floorPlan={spots.length ? page.floorPlan : null}
      spots={spots}
    />
  );
}
