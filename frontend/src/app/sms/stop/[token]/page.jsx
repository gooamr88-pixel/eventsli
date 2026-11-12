import Unsubscribe from './Unsubscribe';

export const metadata = {
  title: 'Stop offers by text',
  robots: { index: false, follow: false, nocache: true },
};

export default async function Page({ params }) {
  const { token } = await params;
  return <Unsubscribe token={String(token)} />;
}
