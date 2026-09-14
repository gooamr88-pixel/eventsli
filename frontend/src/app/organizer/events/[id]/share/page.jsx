import SharePanel from './SharePanel';

export const metadata = {
  title: 'Share & QR',
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }) {
  const { id } = await params;
  return <SharePanel eventId={id} />;
}
