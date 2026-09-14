import DoorTeam from './DoorTeam';

export const metadata = {
  title: 'Door team',
  robots: { index: false, follow: false },
};

export default async function DoorTeamPage({ params }) {
  const { id } = await params;
  return <DoorTeam eventId={id} />;
}
