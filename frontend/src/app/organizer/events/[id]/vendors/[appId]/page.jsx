import ApplicationDetail from './ApplicationDetail';

export const metadata = {
  title: 'Vendor application',
  robots: { index: false, follow: false },
};

/** One vendor application (2026-11-20). */
export default async function VendorApplicationPage({ params }) {
  const { id, appId } = await params;
  return <ApplicationDetail eventId={id} appId={appId} />;
}
