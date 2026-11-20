import MySponsorships from './MySponsorships';

export const metadata = {
  title: 'Sponsorships',
  robots: { index: false, follow: false },
};

/** Sponsorship proposals sent to this account's address (2026-11-20). */
export default function SponsorshipsPage() {
  return <MySponsorships />;
}
