import { serverFetch } from '../../utils/apiClient';
import Markdown from '../../components/Markdown';

/**
 * The organizer agreement — a different document, a different audience, and a
 * separately versioned acceptance. Same rule as the buyer's: rendered from the
 * published version, never from a copy here.
 */
/** Per request, not cached — same reasoning as /terms: a static prerender
 *  caches a FAILED fetch exactly like a successful one, and this document is
 *  what an organizer is asked to accept before publishing. */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Organizer agreement',
  description: 'The agreement between Eventsli and an event organizer.',
};

export default async function OrganizerTermsPage() {
  let terms = null;
  try {
    terms = await serverFetch('/public/terms/organizer', { cache: 'no-store' });
  } catch { /* rendered as unavailable below */ }

  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--md fx-stack">
        {terms ? (
          <>
            <Markdown source={terms.bodyMarkdown} />
            <p className="border-t border-border-base pt-4 font-mono text-xs text-subtle">
              Version {terms.version}
              {terms.publishedAt && (
                <> · published {new Intl.DateTimeFormat('en-US', { dateStyle: 'long' })
                  .format(new Date(terms.publishedAt))}</>
              )}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl">Organizer agreement</h1>
            <p className="text-muted">We could not load the agreement just now.</p>
          </>
        )}
      </div>
    </main>
  );
}
