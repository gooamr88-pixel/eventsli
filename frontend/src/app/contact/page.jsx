import Link from 'next/link';
import PageHeader from '../components/marketing/PageHeader';
import { Band } from '../components/marketing/Blocks';
import { CONTACT_EMAIL } from '../lib/siteRoutes';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Contact.
 *
 * NO FORM, and that is a decision rather than an omission.
 *
 * There is no contact endpoint on the API. A form posting to nothing — or to a
 * third-party form service — looks like it worked, thanks somebody for getting
 * in touch, and drops the message. That failure is invisible to us and total for
 * them, and the people most likely to hit it are the ones with a problem urgent
 * enough to go looking for a contact page.
 *
 * A mailto link cannot lie about whether it sent. It also puts the message in a
 * mailbox with a reply address attached, which is what somebody chasing a
 * ticket an hour before doors actually needs.
 *
 * The first section is the more useful answer for most visitors: the thing they
 * came to ask can be done faster without us.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const metadata = {
  title: 'Contact',
  description: 'How to reach us, what to include, and the three things that are faster to do yourself.',
  alternates: { canonical: '/contact' },
};

const SELF_SERVE = [
  {
    title: 'Lost your ticket email',
    body: 'Have it sent again from Find my tickets. No account and no waiting.',
    href: '/tickets/find',
    cta: 'Find my tickets',
  },
  {
    title: 'A refund, a date change, a question about the event itself',
    body: 'Tickets are non-refundable by default, and any refund is between you and the organizer '
      + '— the money went to them and the event is theirs to run. Their name is on the event page '
      + 'and on your ticket email.',
    href: '/events',
    cta: 'Find the event',
  },
  {
    title: 'Forgotten your password',
    body: 'Reset it yourself; the link arrives by email in a minute or two.',
    href: '/forgot-password',
    cta: 'Reset password',
  },
];

const SUBJECTS = [
  ['Support', 'Something is not working, or a ticket has gone missing.'],
  ['Organizer', 'You want to sell with us, or you are stuck setting an event up.'],
  ['Security', 'You have found a vulnerability. See the trust page first.'],
  ['Legal', 'Data requests, takedowns, anything with a deadline on it.'],
];

export default function ContactPage() {
  return (
    <main>
      <PageHeader
        eyebrow="Contact"
        title="One address, and a person reads it."
        lede="Before you write: three of the four things people email about can be done in less
              time than it takes to type the email."
      />

      <Band title="Faster than emailing us" flush>
        <ul className="fx-grid fx-grid--3">
          {SELF_SERVE.map((item) => (
            <li
              key={item.title}
              className="fx-stack fx-stack--sm es-card p-5"
            >
              <h3 className="text-md text-ink">{item.title}</h3>
              <p className="text-sm text-muted">{item.body}</p>
              <Link href={item.href} className="text-sm text-accent hover:text-accent-hover">
                {item.cta} →
              </Link>
            </li>
          ))}
        </ul>
      </Band>

      <Band title="Writing to us">
        <p className="max-w-[62ch] text-muted">
          Everything goes to{' '}
          {/* Underlined, not merely coloured. A link inside a paragraph has to be
              distinguishable from the text around it by something other than
              colour — WCAG 1.4.1, and Lighthouse's `link-in-text-block`. The
              standalone links elsewhere on the page are their own block and do
              not need it. */}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent underline hover:text-accent-hover">
            {CONTACT_EMAIL}
          </a>. Put one of these words at the front of the subject line — it is how the mailbox
          is sorted, and it is the difference between an answer today and an answer this week.
        </p>

        <dl className="fx-stack fx-stack--sm max-w-[62ch]">
          {SUBJECTS.map(([subject, when]) => (
            <div key={subject} className="fx-row items-start border-t border-border-base pt-3 first:border-0 first:pt-0">
              <dt className="w-[14ch] flex-none">
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`}
                  className="font-mono text-sm text-accent hover:text-accent-hover"
                >
                  {subject}
                </a>
              </dt>
              <dd className="fx-min0 text-sm text-muted">{when}</dd>
            </div>
          ))}
        </dl>

        <div className="fx-stack fx-stack--sm max-w-[62ch] es-card p-5">
          <h3 className="text-md text-ink">What to include</h3>
          <p className="text-sm text-muted">
            The order reference or the event name, and the email address you used to buy. With
            those two we can find the ticket; without them, the first reply is only going to ask
            for them.
          </p>
          <p className="text-sm text-subtle">
            Never send a card number, a password, or your ticket’s QR image. Nobody here will
            ever ask for any of the three.
          </p>
        </div>

        <p className="max-w-[62ch] text-sm text-subtle">
          We are a small team across Canada and the United States, so replies land on business
          days. If doors are in the next few hours, say so in the first line.
        </p>
      </Band>
    </main>
  );
}
