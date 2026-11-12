import CountryDetail from './CountryDetail';

export const metadata = {
  title: 'SMS country',
  robots: { index: false, follow: false },
};

export default async function Page({ params }) {
  const { iso2 } = await params;
  return <CountryDetail iso2={String(iso2).toUpperCase()} />;
}
