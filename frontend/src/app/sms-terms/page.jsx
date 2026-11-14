/**
 * Text message terms — the public page carriers and SMS providers ask for.
 *
 * A toll-free or 10DLC registration needs a public link that shows how people
 * agree to texts, what they will receive, how often, and how to stop. This page
 * is that link, and it is also where a texter lands who wants to know what they
 * signed up for.
 *
 * Written from what the software does, like /privacy:
 *   - the consent sentences are CONSENT_TEXT itself, so this page cannot quote
 *     wording the checkout no longer shows;
 *   - the sample messages are the templates in backend/services/sms/notifications.js;
 *   - the keywords are backend/services/sms/keywords.js;
 *   - frequency and quiet hours are the category defaults in the SMS migration
 *     (marketing: one a day at most, held overnight, opt-out line always added).
 * When any of those change, this page changes in the same commit and UPDATED moves.
 *
 * ⚠ Accurate, but NOT reviewed by a lawyer.
 */
import Link from 'next/link';
import PageHeader from '../components/marketing/PageHeader';
import { CONTACT_EMAIL } from '../lib/siteRoutes';
import { consentText } from '../lib/smsConsentText';

export const metadata = {
  title: 'Text message terms',
  description: 'What texts Eventsli sends, how you agree to them, how often they come, and how to stop them.',
};

const UPDATED = '13 November 2026';

const WHAT = [
  ['Ticket confirmations', 'One text when your order is confirmed, saying which event and how many tickets. Only if you agreed to texts about your tickets.'],
  ['Event reminders', 'One text shortly before an event you have tickets for, however many orders you placed for it.'],
  ['Changes and cancellations', 'If the event you have tickets for moves to a new date or time, or is cancelled.'],
  ['Account notices', 'Important notices about your account, your tickets and your events, if you agreed to them when you signed up.'],
  ['Eventsli news and offers', 'Only if you ticked the separate box for them. Never because you bought a ticket.'],
  ['News from an organizer', 'Only if you ticked the box for that organizer at checkout. Sent through Eventsli, checked by our team before it goes out, and only to people who agreed to hear from that organizer.'],
];

const SAMPLES = [
  'Eventsli: You’re going to Summer Jazz Night, Sat, Jun 14, 8:00 PM. 2 tickets confirmed. Your tickets are in your email.',
  'Eventsli: Reminder: Summer Jazz Night starts Sat, Jun 14, 8:00 PM at Harbourfront Hall. Your tickets are in your email.',
  'Eventsli: Summer Jazz Night has moved to Sun, Jun 15, 8:00 PM. Your tickets stay valid.',
];

const BOXES = [
  ['At checkout, about your tickets', consentText('checkout.transactional.v1')],
  ['At checkout, from the organizer', consentText('checkout.marketing_organizer.v1', { organizer: 'the event organizer' })],
  ['At checkout, from Eventsli', consentText('checkout.marketing_platform.v1')],
  ['When you create an account', consentText('registration.transactional.v1')],
  ['When you create an account, news and offers', consentText('registration.marketing.v1')],
];

const linkClass = 'text-accent underline';

function Rows({ rows }) {
  return (
    <dl className="fx-stack fx-stack--sm">
      {rows.map(([what, why]) => (
        <div key={what} className="border-t border-border-base pt-3 first:border-0 first:pt-0">
          <dt className="text-ink">{what}</dt>
          <dd className="max-w-[62ch] text-sm text-muted">{why}</dd>
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

function Keyword({ children }) {
  return <span className="font-semibold text-ink">{children}</span>;
}

export default function SmsTermsPage() {
  const mail = <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>{CONTACT_EMAIL}</a>;
  return (
    <main className="es-mk">
      <PageHeader
        eyebrow="Legal"
        title="Text message terms"
        lede="What texts Eventsli sends, how you agree to them, how often they come, and how to stop them at any time."
      />
      <div className="fx-section fx-section--sm">
      <article className="es-mk-doc fx-stack">
        <p className="text-sm text-subtle">Last updated {UPDATED}</p>

        <Section id="program" title="The program">
          <p className="max-w-[62ch] text-muted">
            Eventsli text messages are sent by Eventsli, the Canadian business that runs eventsli.com, where people buy
            tickets to events and organizers sell them. We text you only about tickets you bought, events you are going
            to and your account, plus news and offers if you separately asked for them.
          </p>
        </Section>

        <Section id="what" title="What we text you">
          <Rows rows={WHAT} />
          <h3 className="text-base text-ink">Examples</h3>
          <ul className="max-w-[62ch] fx-stack fx-stack--sm">
            {SAMPLES.map((s) => (
              <li key={s} className="rounded-lg border border-border-base bg-surface px-3 py-2 text-sm text-muted">{s}</li>
            ))}
          </ul>
        </Section>

        <Section id="agree" title="How you agree">
          <p className="max-w-[62ch] text-muted">
            We text you only if you give us your mobile number and tick a box saying you want texts. The boxes are
            always unticked to begin with, each kind of text has its own box, and buying a ticket or opening an account
            never requires ticking any of them. These are the exact words beside each box:
          </p>
          <dl className="fx-stack fx-stack--sm">
            {BOXES.map(([where, text]) => (
              <div key={where} className="border-t border-border-base pt-3 first:border-0 first:pt-0">
                <dt className="text-sm text-ink">{where}</dt>
                <dd className="max-w-[62ch] text-sm text-muted">&ldquo;{text}&rdquo;</dd>
              </div>
            ))}
          </dl>
          <p className="max-w-[62ch] text-muted">
            We keep a record of what you agreed to, the words you saw and when, so we can show it if you or a phone
            carrier ever ask. You can also turn each kind of text on or off yourself
            under <Link href="/account/messages" className={linkClass}>Account &rarr; Text messages</Link>.
          </p>
        </Section>

        <Section id="often" title="How often">
          <ul className="max-w-[62ch] list-disc fx-stack fx-stack--sm gap-1 pl-5 text-muted">
            <li>Texts about your tickets depend on what you buy: usually a confirmation and a reminder for each event, plus a text if it changes or is cancelled.</li>
            <li>News and offers: message frequency varies.</li>
            <li>News and offers are never sent at night: they wait until morning in your time zone.</li>
          </ul>
        </Section>

        <Section id="stop" title="How to stop">
          <p className="max-w-[62ch] text-muted">
            Reply <Keyword>STOP</Keyword> to any text from us, at any time. You can also
            reply <Keyword>UNSUBSCRIBE</Keyword>, <Keyword>CANCEL</Keyword>, <Keyword>END</Keyword>, <Keyword>QUIT</Keyword> or <Keyword>STOPALL</Keyword>.
            You may get one last text confirming it, and after that we send no more texts to that number, including
            texts about tickets. Changed your mind? Reply <Keyword>START</Keyword>.
          </p>
          <p className="max-w-[62ch] text-muted">
            To stop only news and offers but keep texts about your tickets, turn them off
            under <Link href="/account/messages" className={linkClass}>Account &rarr; Text messages</Link>.
          </p>
        </Section>

        <Section id="help" title="Help">
          <p className="max-w-[62ch] text-muted">
            Reply <Keyword>HELP</Keyword> to any text from us for help, or write to {mail}.
          </p>
        </Section>

        <Section id="cost" title="Cost">
          <p className="max-w-[62ch] text-muted">
            Eventsli does not charge for texts. Message and data rates may apply, depending on your mobile plan. Phone
            carriers are not liable for delayed or undelivered messages.
          </p>
        </Section>

        <Section id="privacy" title="Your number and your privacy">
          <p className="max-w-[62ch] text-muted">
            We use your mobile number only to send the texts described here. We do not sell it, and we do not share
            your number or your consent to texts with anyone for their own marketing. Text-messaging opt-in data and
            consent are not shared with any third party, apart from the SMS providers that deliver our texts (Twilio
            and Vonage). Our <Link href="/privacy" className={linkClass}>privacy policy</Link> explains everything else
            we collect and how we protect it.
          </p>
        </Section>

        <Section id="changes" title="Changes">
          <p className="max-w-[62ch] text-muted">
            If these terms change, we update this page and the date at the top.
          </p>
        </Section>

        <Section id="contact" title="Contact">
          <p className="max-w-[62ch] text-muted">
            Questions about our texts: {mail}.
          </p>
        </Section>
      </article>
      </div>
    </main>
  );
}
