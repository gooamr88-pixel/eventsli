import Commission from './Commission';

export const metadata = {
  title: 'Commission',
  robots: { index: false, follow: false },
};

export default async function CommissionPage({ params }) {
  const { id } = await params;
  return <Commission eventId={id} />;
}
