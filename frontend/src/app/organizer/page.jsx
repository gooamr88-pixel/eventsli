import Dashboard from './dashboard/Dashboard';

export const metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export default function OrganizerHome() {
  return <Dashboard />;
}
