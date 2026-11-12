/** An invoice's history entries, as a line reads — shared by the admin and organizer views. */
export const HISTORY_LABELS = Object.freeze({
  raised: 'Invoice raised',
  reminder_sent: 'Reminder sent',
  overdue: 'Fell due',
  receipt_submitted: 'Receipt sent by the organizer',
  receipt_rejected: 'Receipt not accepted',
  due_changed: 'Due date changed',
  payment_recorded: 'Payment recorded',
  payment_reversed: 'Payment reversed',
  settled: 'Settled in full',
  waived: 'Balance waived',
  reopened: 'Reopened',
  voided: 'Voided',
  note: 'Note',
});
