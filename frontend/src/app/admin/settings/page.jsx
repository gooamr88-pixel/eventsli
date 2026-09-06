import Settings from './Settings';

export const metadata = {
  title: 'Platform settings',
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return <Settings />;
}
