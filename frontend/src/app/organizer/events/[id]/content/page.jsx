import ContentEditor from './ContentEditor';

export const metadata = {
  title: 'Event page',
  robots: { index: false, follow: false },
};

export default async function ContentPage({ params }) {
  const { id } = await params;
  return <ContentEditor eventId={id} />;
}
