import { notFound } from 'next/navigation';
import { loadEventForViewer } from '../../lib/eventAccess';

/**
 * A MISSING EVENT ANSWERS 404, NOT 200 (2026-10-15).
 *
 * `loading.jsx` puts the event page, /seats and /tickets inside a Suspense
 * boundary, so the response status is sent with the skeleton — before the page
 * has asked whether the event exists. Their `notFound()` then ran after the
 * headers had gone: every unknown, draft or suspended slug answered 200 with a
 * "not found" body and a noindex tag, which a crawler reads as a soft 404.
 *
 * A layout renders ABOVE that boundary, so its `notFound()` decides the status.
 * Same URL, tag and lifetime as the page's own fetch, so the page reuses this
 * answer rather than asking twice, and approval still drops it through the tag.
 *
 * A PRIVATE event (2026-11-22) is not missing: locked or not, each page under
 * here draws its own password gate (lib/eventAccess.js), so it passes through.
 */
export default async function EventLayout({ children, params }) {
  const { slug } = await params;
  const { data, locked } = await loadEventForViewer(slug);
  if (!data && !locked) notFound();
  return children;
}
