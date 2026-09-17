import { serverFetch } from '../utils/apiClient';
import PageHeader from '../components/marketing/PageHeader';
import Markdown from '../components/Markdown';

/**
 * The buyer's terms.
 *
 * Rendered from `GET /public/terms/buyer`, never from a copy in this repo.
 * Acceptance is recorded against a VERSION id (BRD §21), so page copy that
 * drifted from the published document would mean buyers agreeing to text they
 * were never shown — exactly the failure versioning exists to prevent.
 *
 * The organizer agreement is a different document for a different audience;
 * it lives at /terms/organizer.
 */
/**
 * Rendered per request, NOT cached — and this is the interesting bit.
 *
 * It was `revalidate = 3600` and that was wrong in a way worth writing down.
 * Next prerenders a static page at BUILD time and caches whatever it produced,
 * including a failure: a cached MISS is stored exactly like a cached hit. The
 * build has no API to talk to — CI's build step deliberately points at an
 * unreachable one to prove pages degrade — so the prerender captured the
 * "could not load the terms" branch and served it for the next hour.
 *
 * On most pages that is a bad hour. On this one it is a legal document sitting
 * behind a REQUIRED checkbox on the checkout: a buyer would be asked to agree
 * to terms the page had just told them it could not show. Per-request is the
 * right trade for a page that is visited rarely and must never be wrong.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Ticket terms',
  description: 'The terms that apply when you buy a ticket through Eventsli.',
};

export default async function TermsPage() {
  let terms = null;
  try {
    terms = await serverFetch('/public/terms/buyer', { cache: 'no-store' });
  } catch { /* rendered as unavailable below */ }

  return (
    <main className="es-mk">
      <PageHeader eyebrow="Legal" title="Ticket terms" lede="The terms you agree to when you buy a ticket on Eventsli." />
      <div className="fx-section fx-section--sm">
      <article className="es-mk-doc fx-stack">
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
            <h1 className="text-2xl">Ticket terms</h1>
            <p className="text-muted">
              We could not load the terms just now. Please try again in a moment — and
              do not complete a purchase until you have been able to read them.
            </p>
          </>
        )}
      </article>
      </div>
    </main>
  );
}
