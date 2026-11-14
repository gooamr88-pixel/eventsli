# Account deletion runbook — Eventsli (website and Check-in app)

**Status: proposed procedure, not yet approved or rehearsed in production.**
Written 2026-11-14 from the local database schema (foreign keys read with
`pg_constraint`) and the backend code. There is no deletion feature in the
product: every step below is manual, done by the owner with database access.
Have it reviewed by counsel before it is promised to anyone.

Words used carefully here:
- **Deleted** — the row or file no longer exists in the live database.
- **Anonymized** — the row stays (other records depend on it) but no longer
  identifies the person.
- **Retained** — kept on purpose, with the reason given.
- **In backups until they expire** — deleted from the live database but still
  inside backups made before the deletion. This is never called "deleted".

## 0. Before starting

1. Confirm the request comes from the account holder: reply to the account's
   own email address and wait for the confirmation.
2. Record the request in a private log: date, user id, email, who handles it.
3. Find the user: `SELECT id, email, role, account_types FROM profiles WHERE lower(email) = lower('<email>');`
4. Decide which case applies (a person can be several):

| Case | How to tell | What it means |
|---|---|---|
| A. Ticket buyer / attendee | orders with `user_id = <id>` or `guest_email` = the email | Orders and tickets are **retained** for tax and accounting (policy: 6 years in Canada); contact details on them are retained with them |
| B. Door staff (Check-in app) | `event_staff.user_id = <id>` | Door access, devices and sessions are deleted; their past check-ins stay, anonymized |
| C. Organizer | `organizers.owner_user_id = <id>` | **Cannot be deleted while it has events or invoices** (`events.organizer_id` and `invoices.organizer_id` are RESTRICT). Financial records are retained; the account is closed and anonymized instead |
| D. Admin | `role = 'admin'` | Hand over admin duties first; audit rows that name them (`admin_audit.actor_id`, NO ACTION) are retained |

**Never run `DELETE FROM profiles` for case C or D.** `organizers.owner_user_id`
cascades, and many tables (admin_audit, invoices, invoice_payments,
orders.recorded_by, tickets.scanned_by, scanner_access, …) reference the
profile with NO ACTION, so the delete either fails or, worse, removes records
the law requires. The procedure anonymizes the profile in place for every
case, which is safe for all four.

## 1. Stop access (all cases)

In one transaction (`BEGIN; … COMMIT;`), with `<id>` the user id:

```sql
DELETE FROM sessions        WHERE user_id = '<id>';   -- website and app sign-ins
DELETE FROM app_auth_codes  WHERE user_id = '<id>';   -- pending "Sign in with Eventsli"
DELETE FROM password_resets WHERE user_id = '<id>';
DELETE FROM email_verifications WHERE user_id = '<id>';
```

Effect on the Check-in app: the next request from any phone signed in as this
person gets 401; the app signs out and deletes its offline guest list
(mobile/src/auth/session.ts).

## 2. Door staff (case B)

```sql
DELETE FROM event_staff WHERE user_id = '<id>';
```

This cascades to the person's door devices (`scan_devices.staff_id → event_staff`,
CASCADE). Their past check-ins in `scans` stay, with `device_id` set to NULL
(ON DELETE SET NULL): **anonymized**, not deleted. The organizer keeps the
fact that a ticket was scanned; nobody can tell any more which person scanned
it. `tickets.scanned_by` (NO ACTION) — check it is not set to this user:
`SELECT count(*) FROM tickets WHERE scanned_by = '<id>';` and set those to NULL
if any.

**Scans still on a phone.** A phone that holds this person's offline scans
(not yet uploaded) keeps them, encrypted, until a colleague working the same
event opens the app with signal. They then upload under the colleague's
session; since the person's device no longer exists, the server records them
under the uploader (the claimed device is not a device of the event any more,
see scanService.syncBatch). The admission is kept; the deleted person is not
named. Nothing on the server can reach into a phone to remove them sooner.

## 3. Organizer (case C)

1. Check what blocks deletion:
   `SELECT count(*) FROM events WHERE organizer_id = '<org id>';` and the same
   for `invoices`, `orders`, `ledger_entries`.
2. If any exist, the organizer record and its events, orders, invoices and
   ledger are **retained** (accounting). Close it instead: unpublish future
   events (cancel and refund through the normal admin flow if tickets were
   sold — a separate, approved decision), and remove its door teams
   (`DELETE FROM event_staff WHERE event_id IN (SELECT id FROM events WHERE organizer_id = '<org id>')`).
3. Stripe: the connected account belongs to the organizer (merchant of
   record). Eventsli cannot delete it; the organizer closes it with Stripe.
   Record that it was explained to them.
4. Then anonymize the profile (step 5).

## 4. Buyer / attendee (case A)

- `orders.user_id` is SET NULL when a profile is deleted; with the profile
  anonymized instead, the link stays but points at an anonymous profile.
- `orders.guest_email`, `orders.guest_phone`, `tickets.attendee_name`,
  `tickets.attendee_email` are **retained** with the order for the accounting
  period, then deleted with it. State this in the reply.
- SMS: `UPDATE sms_consents SET user_id = NULL WHERE user_id = '<id>';` is done
  by the anonymization below only for the link; the consent and opt-out
  record itself is **retained** as evidence (policy: "kept as long as we might
  text your number"). Keep the suppression so the number is never texted.
- Promo redemptions: `promo_redemptions.email` — set to NULL for this email
  unless an order needs it.

## 5. Anonymize the profile (all cases)

```sql
UPDATE profiles SET
  email          = 'deleted-' || id || '@deleted.invalid',
  full_name      = NULL,
  phone          = NULL,
  organization_name = NULL,
  password_hash  = NULL,
  is_blocked     = true,
  email_verified_at = NULL,
  updated_at     = now()
WHERE id = '<id>';
DELETE FROM ai_generations WHERE user_id = '<id>';   -- AI draft usage (policy: deleted with the account)
```

`terms_acceptances` (CASCADE on delete; here kept) holds an email copy:
`UPDATE terms_acceptances SET email = NULL WHERE user_id = '<id>';` — keep the
acceptance itself as evidence of what was agreed, unless counsel says otherwise.

Check `password_hash` may be NULL and `email` has no other constraint in
production before running (`\d profiles`). Rehearse on a local copy first.

## 6. Outside the database

| Where | What is there | What to do | Honest status |
|---|---|---|---|
| Database backups (Supabase) | Everything above, as of each backup | Nothing can be removed from a backup | **In backups until they expire** (confirm the plan's backup/PITR window in the Supabase dashboard and state it) |
| nginx access logs | IP address, request paths; **guest search text** while query strings are logged (PRIVACY-AUDIT-FINAL.md, P-F2) | Nothing per person | Deleted when the log rotates out (default logrotate keeps 14 days — **unverified** on the server) |
| pm2 logs (`logs/backend-*.log`) | Application events: ids, no passwords or tokens (redacted) | Nothing per person | **No rotation configured in the repository** — retention unknown until checked on the server |
| Brevo (email) | Emails sent to the address | Delete the contact in Brevo | Per Brevo's retention |
| Stripe | Payments, as the organizer's records | Not Eventsli's to delete (merchant of record is the organizer) | Retained by Stripe/organizer |
| Sentry | Nothing personal by design (scrubbed); off until a DSN is set | None | — |
| Expo (EAS Update) | A random install id per phone, not linked to the person | Cannot be tied to the person | Per Expo's retention |
| The person's own phones | Check-in app data | Removed by step 1 on the next start with signal; uninstalling removes it at once | Encrypted until then |

## 7. Verify, then close

```sql
SELECT email, full_name, phone, password_hash IS NULL AS no_password, is_blocked FROM profiles WHERE id = '<id>';
SELECT count(*) FROM sessions WHERE user_id = '<id>';            -- 0
SELECT count(*) FROM event_staff WHERE user_id = '<id>';         -- 0
SELECT count(*) FROM app_auth_codes WHERE user_id = '<id>';      -- 0
SELECT count(*) FROM profiles WHERE lower(email) = lower('<original email>');   -- 0
```

Then try to sign in with the old email on the website and in the app: both
must refuse. Reply to the person, in plain words, with: what was deleted,
what was anonymized, what is retained and why (with the period), and that
backups expire after <window>. Record the completion date in the private log.
Answer within the legal deadline that applies (for example 30 days under
GDPR; PIPEDA requires a reasonable time).
