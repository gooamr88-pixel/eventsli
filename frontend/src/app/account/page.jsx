import BuyerDashboard from './dashboard/BuyerDashboard';

/**
 * `/account` — which had a layout and no page, so the bare path 404'd while
 * being the thing the product called somebody's account. The API's landing rule
 * pointed at `/account/tickets` for that reason: a sub-page, because the parent
 * did not exist.
 */
export const metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export default function AccountHome() {
  return <BuyerDashboard />;
}
