# Venue map library (2026-11-24)

Seating maps of real venues that any organizer can drop into an event's Venue
Builder, plus the maps organizers save for themselves. **Map only** (owner's
rule): the room (tables, rows, sections, areas, walls, the venue size and the
look) and never prices, ticket types, add-ons, sales or event details.

This is separate from [event templates](TEMPLATES.md), which copy a whole event
setup.

## What a venue map holds

Stored in `venue_map_templates` (migration `20261214090000`):

- **The venue:** name, address, city, region, country, Google place id,
  coordinates and kind (arena, stadium, theatre, concert hall, ballroom, banquet
  hall, conference centre, club, outdoor, other).
- **The map:** `data = { layout, tables, groups }`. `layout` is the saved map's
  layout without its 360° views or venue photo, which belong to the source
  event's storage. `tables` are label, seats, shape, position and section/row.
  `groups` are the colour groups taken from the table categories the map uses;
  on use, each group finds the event's category with the same name.
- **A summary** for cards: seats, tables, rows, sections, areas, walls, and a
  small `sketch` that draws the card thumbnail without loading the whole map.
- Status (draft, published or hidden), featured, verified, order, the source
  (event, image or template), a source note shown to organizers, and a use
  count.

## Where it is

| Who | Where | What |
|---|---|---|
| Super admin | `/admin/venue-maps` (Storefront → Venue maps) | Add a venue map, edit, publish, hide, feature, verify, replace the map, delete; add an organizer's map to the library. Every admin can look. |
| Super admin | Admin event page → Add to venue maps | Opens Add a venue map with that event's venue and map filled in |
| Organizer | Venue Builder → Save as template | This event's **saved** map, into Your maps |
| Organizer | Venue Builder → empty map | "The map of <venue>" when the library has one for this event's venue |
| Organizer | Venue Builder → Start from → A ready-made map | Ready for this venue · Venue library · Your maps · Event templates |
| Organizer | Templates → Venue maps | Browse, preview, Use in an event (`/organizer/events/:id/map?venueMap=<id>`), copy, rename, delete, save an event's map |

## Adding a venue map (super admin)

1. **Venue.** Venue search fills the name, address, city and Google place. The
   place id is what later offers the map first to an organizer booking that
   venue; without one, the match is the same name in the same city.
2. **Map.** Either *an event held here* (events at that place, or that name and
   city, that have a map; or search any event by title), or *a seating-chart
   picture*: the same AI reader as the Venue Builder's import
   (`POST /admin/venue-maps/read-image`, a background job). It uses no
   organizer's daily drafts and has its own limit of 20 per 10 minutes. The
   admin compares the rebuilt map with the picture before using it.
3. **Layout.** Its name ("Concert — end stage"), notes, a source credit, and
   "checked against the real venue" (the Verified badge).

It is saved as a **draft**. Publish it when it is right. To refine a map by
hand, draw it in an event's Venue Builder and use **New map** → that event.

## API

- Organizer: `GET /organizer/venue-maps?eventId=` (returns `mine`, `library`,
  `forVenue`, `venue`), `GET/PATCH/DELETE /organizer/venue-maps/:id`,
  `POST /organizer/venue-maps` `{ eventId, name, description, venueKind }`,
  `POST /organizer/venue-maps/:id/copy`, `POST /organizer/venue-maps/:id/used`
- Admin (writes need a super admin and are audited as `venue_map.*`):
  `GET /admin/venue-maps?scope=&q=&status=&kind=`,
  `GET /admin/venue-maps/venue-events?placeId=|name=&city=`,
  `GET /admin/venue-maps/:id`, `POST /admin/venue-maps` `{ venue, eventId | data, … }`,
  `PUT /admin/venue-maps/:id/map`, `PATCH`/`DELETE /admin/venue-maps/:id`,
  `POST /admin/venue-maps/:id/promote`,
  `POST /admin/venue-maps/read-image` and `GET /admin/venue-maps/read-image/:jobId`

## Limits and rules

- 50 saved maps per organizer, about 900 KB per map, and at most 400 tables of
  1 to 60 seats each, with every table named once.
- Using a map changes nothing until the organizer clicks **Save map**, and one
  undo puts the old map back. A map with seats held or sold cannot be replaced.
- Without the migration, the pages say the library is not switched on yet; the
  rest of the Venue Builder works as before.

## Deploy

Apply `20261214090000_venue_map_templates.sql` before or after the code; nothing
else reads the table. `scripts/migration-gap.js` checks for it.
