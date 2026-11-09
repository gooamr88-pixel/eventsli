# App review — Eventsli Check-in

What Apple's and Google's reviewers need, and the review risks we know of.

## Before submitting: a review account in PRODUCTION (owner)

Reviewers use the store build, which talks to `https://eventsli.com`. The local
demo (`backend/scripts/demo-checkin.js`) refuses to run against production by
design, so this is made by hand, on the live site, by the owner:

1. Create an organizer account, for example `appreview@eventsli.com`, with a
   strong password that is not used anywhere else.
2. Create a free event named "App Review Demo" that runs for the whole review
   window (two weeks). Set it to unlisted if the site supports it, so the
   public cannot find it.
3. Issue 5 to 10 tickets to the review account's own email address. Print the
   ticket page, or save it as a PDF, so the reviewer can scan from a second
   screen.
4. Keep **offline check-in** on, with names included.
5. After approval, cancel the event and close the account.

## Notes for the reviewer (paste into App Review Information)

> Eventsli Check-in is the door app for organizers who sell tickets on
> eventsli.com. It is a business tool: it has no sign-up, and people sign in
> with an existing Eventsli account.
>
> Sign in with: appreview@eventsli.com / (password)
>
> 1. Choose "App Review Demo" and tap Continue.
> 2. Tap Scan Tickets and scan a ticket from the attached PDF, shown on another
>    screen. It is admitted; scanning it again shows "Already checked in".
> 3. Attendees lists the guests; Analytics shows arrivals.
> 4. Turn on airplane mode and scan another ticket: the phone checks it itself
>    and uploads it when the connection returns.
>
> The camera is used only to read QR codes. Nothing is recorded or stored.

## Known review risks

- **Sign in with Apple (Guideline 4.8).** "Sign in with Eventsli" opens our
  website, whose sign-in page also offers Google. Apple can read that as a
  third-party login and ask for Sign in with Apple.
  - Mitigation: email and password is the main way in, and the app is our own
    account system; say so in the notes above.
  - If Apple still objects: hide the Google button on the website's sign-in page
    when it is reached from the app (`/app-auth`), or add Sign in with Apple to
    the website. Either is a website change; the app does not change.
- **Minimum functionality (4.2).** A reviewer with no event sees an empty
  event list. The review account above prevents that.
- **Google Play, personal developer accounts.** Accounts created after November
  2023 must run a closed test with at least 12 testers for 14 days before a
  production release. An organization account is exempt.
- **Data safety and privacy policy.** The privacy policy must cover the app
  before submission (see PRIVACY.md).
