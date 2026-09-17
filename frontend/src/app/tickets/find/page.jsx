import Link from 'next/link';
import PageHeader from '../../components/marketing/PageHeader';
import FindTicketForm from './FindTicketForm';

export const metadata = {
  title: 'Find my tickets',
  description: 'Have your tickets sent to your email again.',
};

/**
 * A single-purpose page, so a centred header and one card: the email field is
 * the only thing anybody comes here to use.
 */
export default function FindTicketPage() {
  return (
    <main className="es-mk">
      <PageHeader
        centered
        eyebrow="Your tickets"
        title="Find my tickets"
        lede="Enter the email you bought with and we will send your tickets again. No account needed."
      />
      <div className="fx-section fx-section--sm">
        <div className="es-mk-card">
          <FindTicketForm />
          <p className="es-mk-card__foot">
            Still stuck? <Link href="/contact" className="es-lp-link">Contact us</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
