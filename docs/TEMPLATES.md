# Event templates (2026-11-19)

Organizers save an event's setup as a template and start new events from it.
Eventsli keeps its own templates, shared with every organizer and managed by
super admins.

## What a template holds

A snapshot taken by `backend/services/eventTemplateService.js`:

- the event's details (title, description, category, venue, city, time zone,
  admission and purchase settings, usual start time and length) — these
  pre-fill the new-event form, and the organizer still picks the dates;
- ticket types, add-ons and table categories;
- the seating map: tables (shapes, seats per side, styles), areas, walls, the
  venue size and the map look.

Never copied: sales, buyers, dates, pictures (uploads belong to their event),
360° photos, and private-table passwords (tables arrive public).

## Where it is

| Who | Where | What |
|---|---|---|
| Organizer | `/organizer/templates` (sidebar: Templates) | Their library and Eventsli's; Use, Preview, Copy to mine, Rename, Delete, Save an event as a template |
| Organizer | Event → More → Save as template | Opens Save on that event |
| Organizer | New event → Start from a template | The templates page |
| Organizer | Venue Builder → Add to layout → Map from a template | The map only, into the unsaved draft; ticket types matched by name |
| Admin | `/admin/templates` (Storefront → Event templates) | Every admin can look; a super admin creates from any event, edits, publishes, hides, features, orders, refreshes from the source event, deletes, and copies an organizer's template into Eventsli's |
| Admin | Admin event page → Make Eventsli template | Opens New template on that event |

Eventsli templates start as **drafts** (admins only), become **published**
(every organizer) and can be **hidden** without deleting them.

## Using one

`/organizer/events/new?template=<id>` reads the template and opens the wizard
pre-filled. After `POST /events` creates the draft,
`POST /events/:id/apply-template` copies ticket types, categories, add-ons and
the map. It refuses an event that is not a draft or already has ticket types or
a map, and warns when the template's currency differs from the event's.

## API

- `GET/POST /organizer/templates`, `GET/PATCH/DELETE /organizer/templates/:id`,
  `POST /organizer/templates/:id/copy`
- `POST /events/:eventId/apply-template`
- `GET /admin/templates?scope=platform|organizer&q=`, `GET /admin/templates/:id`,
  `POST /admin/templates`, `PATCH/DELETE /admin/templates/:id`,
  `POST /admin/templates/:id/promote`, `POST /admin/templates/:id/refresh`
  (writes need a super admin; every write is in the audit log)

## Limits

50 templates per organizer; about 900 KB per template (a 400-table map is far
under). Needs migration `20261129090000_event_templates.sql`; without it the
pages say templates are not switched on yet.
