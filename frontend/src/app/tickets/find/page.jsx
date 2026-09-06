import FindTicketForm from './FindTicketForm';

export const metadata = {
  title: 'Find my tickets',
  description: 'Have your tickets sent to your email again.',
};

export default function FindTicketPage() {
  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--sm fx-stack">
        <div className="fx-stack fx-stack--sm">
          <h1 className="text-xl">Find my tickets</h1>
          <p className="text-muted">
            Enter the email you bought with and we will send the link again.
          </p>
        </div>
        <FindTicketForm />
      </div>
    </main>
  );
}
