/**
 * Privacy.
 *
 * Written from what the system ACTUALLY stores, read off the schema and the
 * services rather than adapted from a template — every row below corresponds to
 * a real column, a real job or a real third-party call. That is the only kind of
 * privacy notice worth having: one that describes the software. When the code
 * changes what it collects, keeps or sends, this page changes in the same
 * commit, and `UPDATED` moves.
 *
 * Re-verified line by line on 2026-10-18 when the Smart Event Creator added two
 * AI providers. Facts the code cannot answer came from the owner the same day:
 * the business is named "Eventsli", requests go to info@eventsli.com, the server
 * is in the United States, and accounts are 16 and over. The database region
 * (AWS us-west-1) is read from the deployment settings.
 *
 * Not rendered from the database like the terms are: nobody accepts this
 * document, so it is not versioned or bound to an acceptance.
 *
 * ⚠ Accurate, but NOT reviewed by a lawyer. PIPEDA, Quebec's Law 25 and the US
 * state laws the platform sells into should be checked by one before launch —
 * the cross-border and retention sections especially.
 */
import PageHeader from '../components/marketing/PageHeader';
import { CONTACT_EMAIL } from '../lib/siteRoutes';

export const metadata = {
  title: 'Privacy',
  description: 'What Eventsli collects, why, who it is shared with, where it is stored, and the choices you have.',
};

const UPDATED = '18 October 2026';

const SUMMARY = [
  'We collect what it takes to sell, deliver and check tickets, and to run an organizer account. Nothing for advertising.',
  'We do not sell your personal information, and we do not use it for targeted advertising.',
  'One cookie, set when you sign in, to keep you signed in. No tracking or advertising cookies.',
  'Our database and servers are in the United States. Ticket emails are sent from the European Union.',
  'You can ask to see, correct or delete what we hold about you at any time.',
];

const COLLECTED = [
  {
    group: 'If you buy or claim a ticket',
    rows: [
      ['Your email address', 'To send your tickets and receipt, and to let you find them again. Required.'],
      ['Your name', 'Printed on the ticket and given to the organizer so they can admit you at the door.'],
      ['Your phone number', 'Optional. Only if you give it, and only passed to the organizer of the event you bought from.'],
      ['What you bought', 'The event, the seats or ticket types, the amounts, any discount code, and when. Kept as a financial record.'],
      ['Check-in at the door', 'When your ticket was scanned, and by which door device or staff member. Stops a ticket being used twice.'],
      ['Ticket transfers', 'If you pass a ticket on, the email address you gave it to and when. Both of you are told by email.'],
      ['Your acceptance of the terms', 'Which version you accepted and when, with a hashed form of your IP address as evidence.'],
    ],
  },
  {
    group: 'If you create an account',
    rows: [
      ['Your password', 'Stored only as a one-way hash (PBKDF2-SHA512). Nobody can read it back, including us.'],
      ['Your sign-in sessions', 'For each device: when you signed in, a short description of the browser, and a hashed IP address. So you can see where you are signed in and end any session.'],
      ['Sign-in protection', 'A count of failed sign-in attempts and, after too many, a short lock on the account.'],
      ['Email codes and reset links', 'Only a keyed hash is stored. A sign-up code expires after 10 minutes and a password reset link after 60 minutes, and each works once.'],
      ['Signing in with Google', 'If you choose it, Google confirms your email address and name. We keep those two things and nothing else from your Google account.'],
    ],
  },
  {
    group: 'If you run events as an organizer',
    rows: [
      ['Your organization', 'Its public name, legal name, description, country and logo. The public name and logo appear on your event pages.'],
      ['Getting paid', 'Card payouts are set up with Stripe, which collects your identity and bank details itself. We keep only your Stripe account reference and whether payouts are enabled. Manual payment instructions you write (such as an e-Transfer address) are shown to your buyers.'],
      ['Your events', 'Everything you enter about an event, including images and sponsor details. Published events are public.'],
      ['Commission and invoices', 'What you owe Eventsli on manual sales, the invoices, and any proof of payment you send.'],
      ['Your door team', 'The email of each person you add to scan tickets, and who added them.'],
      ['AI drafts', 'If you use "Create with AI": when you used it, which AI provider answered, how long it took and how much text it processed. Not your description and not the draft.'],
    ],
  },
  {
    group: 'Everyone who visits',
    rows: [
      ['Visit counts', 'The page path and the day, counted once per visitor per day using a hash of your IP address and browser mixed with a secret and the date, so it is different every day. It cannot be turned back into an address or linked to you, even by us.'],
      ['Server request logs', 'Like almost every website, our server records each request: your IP address, the address you asked for and the time. Used only to keep the site secure and to fix problems.'],
      ['Events near you', 'Only if you press "Near me": your browser’s location, rounded to about 100 metres, is sent to our server to sort events by distance. We do not save it, although it can appear in the server request log for a short time.'],
    ],
  },
];

const USES = [
  ['To provide the service', 'Selling and delivering tickets, letting you in at the door, running organizer accounts, paying organizers and charging commission.'],
  ['To send you email about your activity', 'Tickets, receipts, transfers, sign-in codes and, for organizers, approvals, invoices and door-team notices. We do not send marketing email.'],
  ['To keep accounts and payments safe', 'Spotting repeated sign-in failures, stopping duplicate or fraudulent tickets, and keeping an audit trail of what administrators change.'],
  ['To meet legal and tax obligations', 'Keeping financial records, and answering lawful requests.'],
  ['To understand use of the site', 'Only the anonymous daily visit counts above.'],
];

const SHARED = [
  ['The organizer of an event you bought from', 'Your name, email, phone if you gave it, what you bought and whether you have checked in. They need it to run the event and let you in, and they are responsible for how they use it. To stop hearing from an organizer, contact them directly.', 'Their own location'],
  ['Stripe', 'Takes card payments and pays out organizers. Your card details go to Stripe directly and never reach us; we never see or store a card number.', 'United States and other countries'],
  ['Brevo', 'Sends our emails: tickets, receipts, codes and notices.', 'France (European Union)'],
  ['Supabase, on Amazon Web Services', 'Hosts our database and the images organizers upload.', 'United States (us-west-1)'],
  ['Our server host', 'Runs the website and the API that handle every request.', 'United States'],
  ['Google', 'Only in three cases. If you choose to sign in with Google, to confirm who you are. For organizers, the venue name typed into venue search, to suggest the place. And for organizers who use "Create with AI", the event description, which Google Gemini turns into a draft. We use Gemini’s free tier, and on that tier Google may use what it is sent to improve its products.', 'United States and other countries'],
  ['Groq', 'For organizers using "Create with AI", when Gemini cannot answer: the same event description, to write the draft. Groq says it does not keep it, except for up to 30 days when investigating abuse or a reliability problem.', 'United States'],
  ['OpenStreetMap', 'When you open the map on an event page, your browser loads it from OpenStreetMap, which sees your IP address. We send no referrer.', 'OpenStreetMap Foundation, United Kingdom'],
  ['YouTube and Vimeo', 'Only if you press play on a video on our homepage. Nothing is loaded from them before you do.', 'United States'],
];

const RETENTION = [
  ['Orders, tickets, invoices and payments', 'As long as tax and accounting law requires. In Canada that is generally six years.'],
  ['Your account', 'Until you ask us to close it. Records we must keep by law stay; the rest is deleted.'],
  ['Sign-in sessions', 'Each lasts at most 24 hours. Expired sessions are deleted automatically.'],
  ['Email codes and reset links', 'Useless after 10 and 60 minutes. They are deleted with the account.'],
  ['Visit counts', 'Kept as daily totals. The hashes in them change every day and identify no one.'],
  ['Server request logs', 'Deleted automatically after a short period.'],
  ['AI draft usage', 'Kept with the organizer account and deleted with it.'],
];

const RIGHTS = [
  'Ask what personal information we hold about you, and get a copy in a common format.',
  'Correct anything that is wrong or out of date.',
  'Withdraw your consent, or ask us to delete your information, apart from what the law requires us to keep.',
  'Ask how your information was used and who it was shared with.',
  'Complain to us, and to a privacy regulator.',
];

const linkClass = 'text-accent underline';

function Rows({ rows }) {
  return (
    <dl className="fx-stack fx-stack--sm">
      {rows.map(([what, why, where]) => (
        <div key={what} className="border-t border-border-base pt-3 first:border-0 first:pt-0">
          <dt className="text-ink">{what}</dt>
          <dd className="max-w-[62ch] text-sm text-muted">
            {why}
            {where && <span className="mt-1 block text-xs text-subtle">Where: {where}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="fx-stack fx-stack--sm" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  const mail = <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>{CONTACT_EMAIL}</a>;
  return (
    <main className="es-mk">
      <PageHeader
        eyebrow="Legal"
        title="Your privacy"
        lede="What we collect, why, who else sees it, where it is kept, and what you can ask us to do. Everything below describes what the software actually does."
      />
      <div className="fx-section fx-section--sm">
      <article className="es-mk-doc fx-stack">
        <p className="text-sm text-subtle">Last updated {UPDATED}</p>

        <Section id="who" title="Who we are">
          <p className="max-w-[62ch] text-muted">
            Eventsli is a Canadian business that runs eventsli.com, where people buy tickets and organizers sell them.
            This policy covers everyone who uses it: visitors, ticket buyers, organizers and their door teams. We follow
            Canada&rsquo;s privacy law (PIPEDA), Quebec&rsquo;s privacy law, and the privacy laws of the US states where
            we sell tickets. Our Privacy Officer is responsible for it and can be reached at {mail}.
          </p>
        </Section>

        <Section id="summary" title="In short">
          <ul className="max-w-[62ch] list-disc fx-stack fx-stack--sm gap-1 pl-5 text-muted">
            {SUMMARY.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Section>

        <Section id="collect" title="What we collect">
          {COLLECTED.map(({ group, rows }) => (
            <div key={group} className="fx-stack fx-stack--sm">
              <h3 className="text-base text-ink">{group}</h3>
              <Rows rows={rows} />
            </div>
          ))}
        </Section>

        <Section id="use" title="How we use it">
          <Rows rows={USES} />
          <p className="max-w-[62ch] text-sm text-muted">
            We use your information only for these purposes. Where the law asks for your consent, giving us your details
            to buy a ticket or open an account is that consent, for these purposes and no others.
          </p>
        </Section>

        <Section id="shared" title="Who else sees it">
          <p className="max-w-[62ch] text-muted">
            We do not sell your personal information, and we share it only with the people and services listed here.
            Each service uses it to do its job for us; the one exception is Google&rsquo;s free AI tier, described
            below. We also disclose information when the law requires it,
            and if Eventsli were ever sold or merged, it would pass to the new owner under this same policy.
          </p>
          <Rows rows={SHARED} />
        </Section>

        <Section id="ai" title="Creating events with AI">
          <p className="max-w-[62ch] text-muted">
            Organizers can describe an event in their own words and get a draft to review. Only the organizer&rsquo;s
            description is sent, first to Google Gemini and, if that fails, to Groq. Email addresses and phone numbers
            are removed from it before it leaves our server. No ticket buyer&rsquo;s information is ever sent. We do not
            keep the description or the draft: the draft stays in the organizer&rsquo;s browser until they save it as an
            event. Every draft is checked and edited by the organizer before anything is saved, and nothing is published
            without Eventsli&rsquo;s review. Organizers who prefer not to use AI can create every event by hand.
          </p>
        </Section>

        <Section id="where" title="Where your information is kept">
          <p className="max-w-[62ch] text-muted">
            Our database is hosted in the United States (Amazon Web Services, us-west-1), and so are our servers. Our
            email provider is in the European Union, and the other services above may process information in other
            countries. Information stored outside Canada is protected by these providers&rsquo; own security and terms,
            but it is subject to the laws of the country it is in, and authorities there may be able to access it under
            those laws.
          </p>
        </Section>

        <Section id="cookies" title="Cookies and your browser">
          <p className="max-w-[62ch] text-muted">
            One cookie, and only once you sign in: it holds your session and lasts at most 24 hours. It
            is <span className="text-ink">httpOnly</span>, which means no script on the page can read it, including ours.
            We use no advertising, analytics or tracking cookies.
          </p>
          <p className="max-w-[62ch] text-muted">
            Some things are kept only in your own browser and never sent to us: the events you save, and forms you are
            part-way through (these clear when you close the tab). The Google sign-in button, on the sign-in and sign-up
            pages, loads from Google, which may set its own cookies there.
          </p>
        </Section>

        <Section id="keep" title="How long we keep it">
          <Rows rows={RETENTION} />
        </Section>

        <Section id="rights" title="Your choices and rights">
          <p className="max-w-[62ch] text-muted">You can:</p>
          <ul className="max-w-[62ch] list-disc fx-stack fx-stack--sm gap-1 pl-5 text-muted">
            {RIGHTS.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="max-w-[62ch] text-muted">
            Write to {mail} from the email address on your account or tickets, so we can confirm it is you. We answer
            within 30 days. You can also see and end your sign-in sessions yourself, at any time, under Account → Security.
          </p>
          <p className="max-w-[62ch] text-muted">
            If you are not satisfied with our answer, you can complain to the{' '}
            <a href="https://www.priv.gc.ca" className={linkClass} target="_blank" rel="noreferrer">Office of the Privacy Commissioner of Canada</a>
            , or in Quebec to the{' '}
            <a href="https://www.cai.gouv.qc.ca" className={linkClass} target="_blank" rel="noreferrer">Commission d&rsquo;accès à l&rsquo;information</a>
            . In the United States, residents of some states have similar rights under their state&rsquo;s law, and we
            honour them the same way.
          </p>
        </Section>

        <Section id="security" title="How we protect it">
          <p className="max-w-[62ch] text-muted">
            Every connection is encrypted. Passwords and IP addresses are stored only as hashes. Card details never
            reach us. Access to the database is limited to the service itself and to a small number of administrators,
            and administrators&rsquo; changes are logged. If a breach ever put you at real risk of significant harm, we
            would tell you and the Privacy Commissioner as the law requires.
          </p>
        </Section>

        <Section id="children" title="Children">
          <p className="max-w-[62ch] text-muted">
            You must be 16 or older to create an Eventsli account. Younger people can attend events with tickets bought
            for them by an adult. We do not knowingly collect information from children under 16; if you believe we
            have, write to {mail} and we will delete it.
          </p>
        </Section>

        <Section id="changes" title="Changes to this policy">
          <p className="max-w-[62ch] text-muted">
            When what we collect or share changes, we update this page and the date at the top. If a change is
            significant, we also tell account holders by email before it takes effect.
          </p>
        </Section>

        <Section id="contact" title="Contact">
          <p className="max-w-[62ch] text-muted">
            Questions, requests or complaints about privacy: {mail}, attention Privacy Officer.
          </p>
        </Section>
      </article>
      </div>
    </main>
  );
}
