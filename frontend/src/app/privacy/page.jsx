/**
 * Privacy.
 *
 * Written from what the system ACTUALLY stores, read off the schema and the
 * services rather than adapted from a template — every row below corresponds to
 * a real column or a real third-party call. That is the only kind of privacy
 * notice worth having: one that describes the software.
 *
 * Not rendered from the database like the terms are, because there is no
 * `terms_versions` row for privacy — this is not a document anyone accepts, so
 * it is not versioned or bound to an acceptance.
 *
 * ⚠ Like the seeded terms (see 20260829160000_seed_terms_v1.sql), this is
 * accurate but has NOT been reviewed by a lawyer. Canadian PIPEDA and the US
 * state privacy laws the platform sells into both need that review before
 * launch — the residency and deletion sections especially.
 */
import PageHeader from '../components/marketing/PageHeader';

export const metadata = {
  title: 'Privacy',
  description: 'What Eventsli collects, why, and who it is shared with.',
};

const COLLECTED = [
  ['Your email address', 'To send your tickets and your receipt. It is the only thing we genuinely need to sell you a ticket.'],
  ['Your name', 'Printed on the ticket, and given to the organizer so they can admit you at the door.'],
  ['Your phone number', 'Optional. Only if you give it, and only passed to the organizer of an event you bought from.'],
  ['What you bought', 'The event, the seats, the amount, and when. We are required to keep this as a financial record.'],
  ['A hashed form of your IP address', 'Recorded when you sign in or accept terms, as evidence of when that happened. It is hashed with a secret, so it cannot be read back as an address.'],
  ['Your sign-in sessions', 'So you can see where you are signed in and end a session on a device you no longer have.'],
  ['Email verification codes', 'When you create an account we email a six-digit code to prove the address is yours. Only a keyed hash of the code is stored, it expires after ten minutes, and it works once.'],
];

const SHARED = [
  ['The organizer of an event you bought from', 'Your name, your email, and what you bought. They need it to run the event and let you in. They may not use it to market other events to you without asking you separately.'],
  ['Stripe', 'Takes the payment. Your card details go to Stripe directly and never reach us — we never see or store a card number.'],
  ['Brevo', 'Sends your tickets and receipts by email.'],
  ['Supabase', 'Hosts the database and the event images.'],
  ['Google', 'Only if you choose to sign in with Google, and only to confirm who you are.'],
];

export default function PrivacyPage() {
  return (
    <main className="es-mk">
      <PageHeader
        eyebrow="Legal"
        title="Your privacy"
        lede="What we collect, why we collect it, and who else sees it. Everything below describes what the software actually does."
      />
      <div className="fx-section fx-section--sm">
      <article className="es-mk-doc fx-stack">

        <section className="fx-stack fx-stack--sm">
          <h2 className="text-lg">What we collect</h2>
          <dl className="fx-stack fx-stack--sm">
            {COLLECTED.map(([what, why]) => (
              <div key={what} className="border-t border-border-base pt-3 first:border-0 first:pt-0">
                <dt className="text-ink">{what}</dt>
                <dd className="max-w-[62ch] text-sm text-muted">{why}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="fx-stack fx-stack--sm">
          <h2 className="text-lg">Who else sees it</h2>
          <p className="max-w-[62ch] text-muted">
            We do not sell your details, and we do not share them with anyone not listed
            here.
          </p>
          <dl className="fx-stack fx-stack--sm">
            {SHARED.map(([who, what]) => (
              <div key={who} className="border-t border-border-base pt-3 first:border-0 first:pt-0">
                <dt className="text-ink">{who}</dt>
                <dd className="max-w-[62ch] text-sm text-muted">{what}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="fx-stack fx-stack--sm">
          <h2 className="text-lg">Cookies</h2>
          <p className="max-w-[62ch] text-muted">
            One cookie, and only once you sign in: it holds your session. It is
            <span className="text-ink"> httpOnly</span>, which means no JavaScript on the
            page can read it, including ours. We use no advertising or tracking cookies.
          </p>
        </section>

        <section className="fx-stack fx-stack--sm">
          <h2 className="text-lg">Keeping and deleting</h2>
          <p className="max-w-[62ch] text-muted">
            Order and ticket records are kept as financial records for as long as the law
            requires. Sign-in sessions end on their own, and you can end any of them
            yourself from your account. To ask what we hold about you, or to have your
            account closed, write to{' '}
            <a href="mailto:privacy@eventsli.com" className="text-accent">privacy@eventsli.com</a>.
          </p>
        </section>
      </article>
      </div>
    </main>
  );
}
