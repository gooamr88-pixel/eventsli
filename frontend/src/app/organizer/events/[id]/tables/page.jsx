import TableCategories from './TableCategories';

export const metadata = {
  title: 'Table categories',
  robots: { index: false, follow: false },
};

export default async function TableCategoriesPage({ params }) {
  const { id } = await params;
  return <TableCategories eventId={id} />;
}
