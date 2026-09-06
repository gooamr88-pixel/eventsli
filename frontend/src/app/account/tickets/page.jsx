import MyTickets from './MyTickets';

export const metadata = {
  title: 'My tickets',
  robots: { index: false, follow: false },
};

export default function MyTicketsPage() {
  return <MyTickets />;
}
