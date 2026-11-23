import { notFound } from 'next/navigation';
import { loadEventForViewer, privateMetadata } from '../../../../../lib/eventAccess';
import PrivateEventGate from '../../../PrivateEventGate';
import BoothDetail from './BoothDetail';

/**
 * ONE BOOTH (owner's reference, 2026-11-21): its photo and what it includes,
 * then "Booth Services" — the booth add-ons and the marketing add-ons — and
 * the total, with Reserve (instant) or Apply (apply). Read from the same
 * public vendor page the list comes from, so the two never disagree.
 */
export const revalidate = 60;

/**
 * The page's data, or `{ locked }` for a private event this visitor has not
 * unlocked (2026-11-22; lib/eventAccess.js) — the password gate stands here.
 */
async function load(slug) {
  const { data, locked } = await loadEventForViewer(slug, { path: '/vendors' });
  return { page: data, locked };
}

export async function generateMetadata({ params }) {
  const { slug, boothId } = await params;
  const { page, locked } = await load(slug);
  if (locked) return privateMetadata(locked.title);
  const booth = page?.booths.find((b) => b.id === boothId);
  if (!booth) return { title: 'Booth', robots: { index: false, follow: false } };
  return { title: `${booth.name} · ${page.event.title}`, description: booth.description?.slice(0, 160) || `A vendor booth at ${page.event.title}.` };
}

export default async function BoothPage({ params, searchParams }) {
  const { slug, boothId } = await params;
  // `?spot=` — the booth tapped on the vendor floor plan (FloorPlanViewer's
  // "Reserve this booth"), chosen on arrival when it is still free.
  const { spot: spotParam } = (await searchParams) || {};
  const { page, locked } = await load(slug);
  if (locked) return <PrivateEventGate event={locked} />;
  const booth = page?.booths.find((b) => b.id === boothId);
  if (!booth) notFound();
  // Only this booth type's spots on the floor plan can be picked here.
  const spots = page.floorPlan
    ? page.floorPlan.plan.elements.filter((e) => e.kind === 'booth' && e.boothTypeId === booth.id).map((e) => e.id)
    : [];
  const wanted = typeof spotParam === 'string' ? spotParam : null;
  const initialSpot = wanted && spots.includes(wanted)
    && (page.floorPlan.booths?.[wanted]?.status || 'available') === 'available' ? wanted : null;
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
      initialSpot={initialSpot}
    />
  );
}
