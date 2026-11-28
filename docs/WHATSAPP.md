# VIP Services and WhatsApp

Organizers ask the Eventsli team to run part of their event for them. The request, and every message about it, is kept in one thread, whatever channel the message used. WhatsApp is the main channel, through Meta's **WhatsApp Business Cloud API**, on the business number **+1 (619) 666-6620**. Email (**info@eventsli.com**) is the fallback.

## 1. What is built

| Where | What |
|---|---|
| Organizer › **VIP Services** (`/organizer/vip`) | The offer (services, how it works), the team's WhatsApp and email, and the organizer's requests, with a dot when the team has written |
| `/organizer/vip/new` | The request form: services, event (theirs, or one not on Eventsli yet), guests, budget, details, and how to reach them (WhatsApp number, WhatsApp opt-in, preferred channel). After sending, **Continue on WhatsApp** opens a chat with the reference already typed in |
| **`/vip` (public, every visitor)** | The same front door for anyone, no account. It is in the site header and footer. The request form sits under the hero, with an optional organization field. A visitor's request comes back with a **private link** (`/vip/request/<id>?t=…`, an HMAC of the id signed with `VIP_LINK_SECRET` or derived from `JWT_SECRET`). That link is also emailed, and from it they follow the request, write, change their WhatsApp settings or cancel. The form is limited to 5 requests per hour per address and has a hidden honeypot field for bots. Search engines are kept away from the private link |
| `/organizer/vip/<id>` | Progress steps, the conversation (WhatsApp, dashboard and email in one thread, refreshed every 20 s), the WhatsApp card (continue the chat, change the number, opt in or out) and cancelling |
| Admin › Sales › **VIP Services** (`/admin/vip`) | **Requests** (counts, filters, search) · **WhatsApp inbox** (chats not tied to a request: reply, link, dismiss) · **Settings** (connection check, the values to paste into Meta, the number, email and services organizers see, and who is emailed) |
| `/admin/vip/<id>` | The thread with a reply box that says before sending where the reply will go (and why), status changes (emailed, plus WhatsApp when that is how the organizer is reached), assignee, private team notes, and an **Open their chat in WhatsApp** link |

**It works before Meta is connected.** Every button opens WhatsApp through `wa.me` links with the request's reference typed in, so the team gets the chat on the business phone. The dashboard thread and the emails work as normal. Once the four values in §3 are set, messages are sent and received through the API and stored on the request.

## 2. How messages travel

**From the team to an organizer** (a reply, or a status change):

1. **The organizer wrote on WhatsApp in the last 24 hours:** a normal WhatsApp message. WhatsApp allows free-form replies only inside this window.
2. **The window is closed, and the organizer agreed to WhatsApp updates and prefers them:** the approved template `vip_request_update`, with the team's words inside it.
3. **Otherwise:** email.

If WhatsApp refuses a message, either immediately or later through a "failed" receipt, the same text goes by email, once. The thread shows why. Ticks follow Meta's receipts (sending, sent, delivered, read) and never go backwards when receipts arrive out of order. When a team member opens a request, the organizer's last WhatsApp message is marked read (blue ticks).

**From an organizer to the team:**

* **On WhatsApp.** A message is tied to a request if it quotes the reference (`VIP-7KQ2MX`) from the request's own number, or if the request has no number yet (that number then becomes the request's). Otherwise it is tied by number: the organizer's latest open request, or one closed in the last 60 days. A reference quoted from a *different* number is not trusted on its own. That message, and anything else unmatched, goes to the **WhatsApp inbox** for the team to link.
* **On the dashboard.** Stored on the request, and the team is emailed.
* **Team emails.** The team is emailed about every new request and every dashboard message. For WhatsApp, only the first message after 30 quiet minutes triggers an email, so a busy chat does not become fifty emails.
* **STOP / START** on WhatsApp turns that number's WhatsApp updates off or back on, across all its requests. The system replies once to confirm.
* **Photos, documents, voice notes:** stored as references to Meta's copy. The team, and the organizer on their own request, open them through the API. The browser never talks to Meta.
* **Team messages from the WhatsApp Business app on the phone** are stored on the request too, but only with coexistence (§3, step 2) and the `smb_message_echoes` webhook field.

## 3. Owner checklist: connecting the API

Only the owner can do these steps, because they need the Meta Business login and the phone.

1. **Meta Business account.** At business.facebook.com, complete **Business verification** (legal name, address, website `eventsli.com`). This unlocks the display name and higher sending limits.
2. **Decide how the number joins. This is the one important decision.**
   * **+1 619 666 6620 is on the WhatsApp Business *app* today (recommended):** onboard it with **coexistence**. The team keeps using the app on the phone, the API runs alongside, and messages typed on the phone are copied to the console. During onboarding, choose "Connect your existing WhatsApp Business app".
   * **It is on regular (personal) WhatsApp:** move it to the WhatsApp Business app first, then use coexistence.
   * **It is moved to the API only, without coexistence:** the app on the phone stops working for that number. The console's VIP Services page and WhatsApp inbox become the only place to read and answer messages. Both already support that.
3. **Meta app.** At developers.facebook.com › My apps › Create app › type **Business**, add the **WhatsApp** product and link it to the business account and the number. Note the **Phone number ID** (WhatsApp › API Setup). It is a long id, not the phone number.
4. **Display name.** In WhatsApp Manager › Phone numbers, set **Eventsli** and wait for approval.
5. **Permanent token.** Business settings › Users › **System users** › Add (role Admin). Assign it the app and the WhatsApp account with full control. Then **Generate token** for the app with `whatsapp_business_messaging` and `whatsapp_business_management`, set to never expire. The 24-hour token on the API Setup page stops working the next day, so never use it in production.
6. **App secret.** Meta app › Settings › Basic › App secret.
7. **Message template.** In WhatsApp Manager › Message templates › Create:
   * Name `vip_request_update`, category **Utility**, language **English (en)**
   * Body, exactly:
     ```
     Hi {{1}}, there is an update on your Eventsli VIP request {{2}}:

     {{3}}

     Reply here to continue with our team, or open the request in your Eventsli dashboard.
     ```
   * Sample values: `Sara` · `VIP-7KQ2MX` · `Our team is reviewing your request now.`
   * Wait for **Approved**. Until then, template sends are refused and fall back to email. Nothing breaks.
8. **Payment method.** In WhatsApp Manager › Payment settings, add a card. Meta charges per template message. Replies inside the 24-hour window are free.
9. **Server.** Set these in the API's environment, then restart the API (pm2):
   ```
   WHATSAPP_ACCESS_TOKEN=<the system user token>
   WHATSAPP_PHONE_NUMBER_ID=<the Phone number ID>
   WHATSAPP_APP_SECRET=<the app secret>
   WHATSAPP_VERIFY_TOKEN=<any long random string>
   ```
   `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` prints a suitable verify token.
10. **Webhook.** In Meta app › WhatsApp › Configuration › Webhook, set:
    * Callback URL: `https://<the API host>/api/v1/webhooks/whatsapp`. Admin › VIP Services › Settings shows this URL with a copy button.
    * Verify token: the same `WHATSAPP_VERIFY_TOKEN`.
    * Press **Verify and save**, then subscribe to the fields **`messages`**, and **`smb_message_echoes`** if coexistence is used.
11. **Check.** Admin › VIP Services › Settings › **Test the connection** should show the verified name and number. Then, from a personal phone, send `Hi` to +1 619 666 6620. It appears in the **WhatsApp inbox** within seconds.

## 4. Deploying

* **Migration first:** `supabase/migrations/20261222090000_vip_services.sql` (two new tables, which nothing else reads; visitor requests have no organizer, `source = 'visitor'`).
* Optional: set `VIP_LINK_SECRET` to a random value so visitor links do not depend on `JWT_SECRET`. Apply it before the API that uses it.
* The API and the frontend ship together (the sidebar entries and the new pages call the new endpoints).
* `scripts/verify-schema.js` now checks for both tables.
* Without the four `WHATSAPP_*` values, the API logs nothing and the feature runs in click-to-chat mode. A partial configuration is logged at boot as a warning.
* `WHATSAPP_DRY_RUN=true` logs what would be sent and sends nothing. Use it on staging.

## 5. Security notes

* The webhook trusts nothing it cannot verify. Every POST must carry Meta's `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret), checked in constant time. Without `WHATSAPP_APP_SECRET`, all webhooks are refused.
* Only events for our Phone number ID are read.
* Each WhatsApp message is stored once, keyed by its id, so Meta's retries change nothing.
* Organizers only ever see their own requests and files. Another organizer's request answers "not found".
* Media is fetched with our token from Meta's media hosts only, and served with `Content-Security-Policy: sandbox` and `nosniff`. Documents are always served as downloads.
* Settings and the connection check are restricted to super admins. Every settings change, status change, link and dismissal is written to the admin audit log.

## 6. Code map

* Backend: `services/whatsapp/` (config, Cloud API client, webhook signature and parser) and `services/vip/` (settings, text rules, store, WhatsApp delivery and inbound, organizer service, console, emails). Routes are `routes/vipRoutes.js` (organizer + webhook) and `routes/admin/vipRoutes.js`. The controller is `controllers/vipController.js`.
* Frontend: `organizer/vip/`, `admin/vip/`, and `components/vip/` (thread, composer, steps, WhatsApp button, admin tabs).
* Tests: backend `test/vipServices.test.js` (rules, signatures, payloads) and `test/integration/vipServices.test.js` (end to end against a fake Meta); frontend `test/vipServices.test.jsx`.
