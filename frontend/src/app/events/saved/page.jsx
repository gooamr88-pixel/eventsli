import PageHeader from '../../components/marketing/PageHeader';
import SavedEvents from './SavedEvents';

/**
 * The events this browser has saved.
 *
 * `noindex`, and `/events/saved` is a private prefix in `lib/siteRoutes.js`.
 * Both say the same thing for two audiences: there is nothing here to index.
 * The list lives in localStorage, so a crawler — and anybody arriving from a
 * search result — would be served a page that is empty for them and describes
 * somebody else's page. It is excluded rather than left to be ranked badly.
 *
 * Deliberately NOT under `/account`. Saving needs no sign-in (that is the whole
 * argument in `useSavedEvents`), so putting the list behind the session wall
 * would bounce the exact people the feature exists for to a login screen.
 */
export const metadata = {
  title: 'Saved events',
  description: 'Events you have saved on this device.',
  robots: { index: false, follow: true },
};

export default function SavedEventsPage() {
  return (
    <main className="es-mk">
      <PageHeader
        eyebrow="Your list"
        title="Saved events"
        lede="Events you kept for later. Saved on this device — no account needed."
      />
      <div className="fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <SavedEvents />
        </div>
      </div>
    </main>
  );
}
