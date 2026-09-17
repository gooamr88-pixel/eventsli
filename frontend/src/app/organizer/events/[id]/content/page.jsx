import ContentEditor from './ContentEditor';

export const metadata = {
  title: 'Page & branding',
  robots: { index: false, follow: false },
};

export default async function ContentPage({ params }) {
  const { id } = await params;
  return <ContentEditor eventId={id} />;
}
