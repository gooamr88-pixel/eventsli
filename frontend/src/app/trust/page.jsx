import Link from 'next/link';
import PageHeader from '../components/marketing/PageHeader';
import { Band, Points } from '../components/marketing/Blocks';
import { CONTACT_EMAIL } from '../lib/siteRoutes';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Security and trust.
 *
 * The hard part of a page like this is not what to put on it — it is what to
 * leave off. Most of them claim a certification nobody has audited, "bank-grade
 * encryption", and a padlock icon.
 *
 * So this page has a section called "What we do not claim", and it is not
 * modesty: an organizer taking money through us has a real due-diligence
 * question, and a list of things we have NOT been audited for is worth more to
 * them than a badge. If we are ever certified for one of them, that line moves
 * up the page. Until then it stays where it is.
 *
 * Every claim above that section is a property of code in this repository.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const metadata = {
  title: 'Security and trust',
  description:
    'How tickets are signed, where card details go, what a lost door tablet can do, '
    + 'and what we deliberately do not claim.',
  alternates: { canonical: '/trust' },
};

const TICKETS = [
  {
    title: 'A ticket is signed, not numbered',
    body: 'Every QR carries a cryptographically signed token rather than a database id. An id '
      + 'in a QR is a credential with no integrity — print a few, notice they are guessable, '
      + 'and you are inside. A code we did not issue cannot be made to verify.',
    detail: 'Signed with a key used for nothing else, so a leaked ticket key cannot mint logins.',
  },
  {
    title: 'The QR image is drawn by us',
    body: 'Not by a public QR-generating service with the admission token in a query string. '
      + 'That is a common shortcut and it hands a third party the credential that opens the '
      + 'door, for every ticket ever sold, in their access logs.',
    detail: 'Served with no-store and a policy that blocks the image from loading anything.',
  },
  {
    title: 'One admission per ticket',
    body: 'Two gates scanning the same code at the same instant produce exactly one entry and '
      + 'one refusal — decided by a lock on the ticket row, not by whichever request happened '
      + 'to arrive first.',
    detail: 'And the refusal carries the time of the first scan.',
  },
  {
    title: 'One transfer, and it is recorded',
    body: 'A ticket can change hands once, when the organizer allows it. The old code stops '
      + 'working the moment the new one is issued.',
  },
];

const MONEY = [
  {
    title: 'We never see a card number',
    body: 'Payment happens on Stripe’s own hosted page, which the browser is sent to. No card '
      + 'field on this site ever holds a card, because there is no card field on this site.',
    detail: 'Stripe is a PCI DSS Level 1 service provider. We are a merchant that redirects to it.',
  },
  {
    title: 'Money goes to the organizer, not to us',
    body: 'Card payments are charged directly to the organizer’s own Stripe account. We hold '
      + 'no float and operate no escrow balance, so there is no pool of other people’s money '
      + 'here to lose.',
  },
  {
    title: 'Prices are integer cents, everywhere',
    body: 'No floating-point arithmetic touches money at any layer — not the database, not the '
      + 'API, not the browser. The frontend’s money module can format a price and cannot add '
      + 'two together, and a test asserts it exports nothing that could.',
    detail: 'parseFloat("19.99") * 100 is 1998.9999999999998. That is the whole reason.',
  },
];

const ACCOUNTS = [
  {
    title: 'Sessions are checked, not just decoded',
    body: 'The session is an httpOnly cookie the browser holds and JavaScript cannot read, and '
      + 'every single request re-checks it against a row in the database. Signing out on one '
      + 'device revokes it everywhere immediately — it does not merely delete a cookie.',
  },
  {
    title: 'Passwords are hashed with PBKDF2-HMAC-SHA512',
    body: '210,000 iterations, the OWASP figure, with a per-password salt. The stored value '
      + 'names its own cost, so the cost can be raised later without invalidating anyone.',
  },
  {
    title: 'The browser never queries the database',
    body: 'Every read and write goes through the API, where authorisation is enforced. This is '
      + 'not a convention — it is a lint rule that fails the build, because a convention '
      + 'decays the first time someone reaches for a quick read.',
  },
  {
    title: 'Credential endpoints are rate limited',
    body: 'Sign-in, password reset and device sign-in are all throttled per address. A door '
      + 'PIN is short by necessity, so it is limited hardest of the three.',
  },
];

const DOOR = [
  {
    title: 'A tablet is its own principal',
    body: 'Door staff do not sign in as a person. A device is registered by the organizer with '
      + 'its own PIN, so nobody at the door needs the organizer’s password and a lost tablet '
      + 'is dealt with on its own.',
  },
  {
    title: 'Revoking a device takes effect at once',
    body: 'Not at its next sign-in. The moment the organizer switches a device off, the token '
      + 'it is already holding stops working — every scan re-checks that the device is still '
      + 'active.',
    detail: 'A revocation that only takes effect later is a false assurance, which is worse than no button.',
  },
  {
    title: 'A tablet opens one event',
    body: 'The event is inside the device’s token and is never read from the request, so one '
      + 'venue’s scanner cannot admit another venue’s guests — or reverse their admissions — '
      + 'by changing a field.',
  },
];

const NOT_CLAIMED = [
  ['SOC 2', 'We have not been audited. If that changes, this line changes.'],
  ['ISO 27001', 'Not certified.'],
  ['PCI DSS compliance of our own', 'Card data never reaches us; Stripe carries that burden and we redirect to them. We do not claim a certification we have no scope for.'],
  ['An independent penetration test', 'Not yet commissioned.'],
  ['A bug bounty programme', 'None yet. Reports are still welcome, and read by a person.'],
];

export default function TrustPage() {
  return (
    <main>
      <PageHeader
        eyebrow="Security and trust"
        title="What protects a ticket, and what protects your money."
        lede="Specific enough to check. Every claim on this page is a property of the running
              system, and the last section is the list of things we deliberately do not claim."
      />

      <Band title="Tickets" flush>
        <Points points={TICKETS} />
      </Band>

      <Band title="Money">
        <Points points={MONEY} />
      </Band>

      <Band title="Accounts">
        <Points points={ACCOUNTS} />
      </Band>

      <Band title="The door">
        <Points points={DOOR} />
      </Band>

      <Band
        title="What we do not claim"
        lede="A platform’s refusals are more informative than its badges. If you need one of
              these for your own compliance, ask before you commit an event to us — the answer
              will be this list, said plainly."
      >
        <dl className="fx-stack fx-stack--sm max-w-[68ch]">
          {NOT_CLAIMED.map(([claim, note]) => (
            <div key={claim} className="fx-row items-start border-t border-border-base pt-3 first:border-0 first:pt-0">
              <dt className="w-[22ch] flex-none text-sm text-ink">{claim}</dt>
              <dd className="fx-min0 text-sm text-muted">{note}</dd>
            </div>
          ))}
        </dl>
      </Band>

      <Band title="Reporting something">
        <p className="max-w-[62ch] text-muted">
          If you have found a vulnerability, write to{' '}
          {/* Inside a sentence, so underlined — see the note on /contact. */}
          <a href={`mailto:${CONTACT_EMAIL}?subject=Security`} className="text-accent underline hover:text-accent-hover">
            {CONTACT_EMAIL}
          </a>{' '}
          with <span className="font-mono text-sm">Security</span> in the subject. Tell us what
          you did and what happened; a proof of concept helps more than a scanner report. Please
          do not test against a live event that other people have bought tickets to — ask us and
          we will point you somewhere safe.
        </p>
        <p className="max-w-[62ch] text-sm text-subtle">
          We read these ourselves. There is no bounty, and we will not pretend otherwise to get a
          report.
        </p>
        <div className="fx-row">
          <Link href="/privacy" className="text-sm text-accent hover:text-accent-hover">
            What we do with your data →
          </Link>
          <Link href="/terms" className="text-sm text-accent hover:text-accent-hover">
            Ticket terms →
          </Link>
        </div>
      </Band>
    </main>
  );
}
