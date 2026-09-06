import Users from './Users';

export const metadata = {
  title: 'People',
  robots: { index: false, follow: false },
};

export default function UsersPage() {
  return <Users />;
}
