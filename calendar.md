# Calendar Feature

Status as of this writing: **calendar shell + real event CRUD + a unified create/edit/view event dialog are built and compiling** (backend `tsc --noEmit` clean, frontend `ng build` dev + prod clean). No live DB/browser has been exercised against this yet in this session — everything below has only been verified by static compilation and manual code tracing, not by clicking through it.

## 1. Context / decisions

- Built with **angular-calendar** (`angular-calendar@0.31.1`, pinned — the latest 0.32.x requires Angular ≥20, this app is Angular 18), `date-fns@^2.30.0`, `angular-draggable-droppable@8.0.0`, `angular-resizable-element@^7.0.2` as its peers.
- **Each user can have multiple named calendars** (confirmed) — modeled as a `Calendar` table (name/color/owner), every `CalendarEvent` belongs to exactly one. No Calendar management UI/endpoints exist yet (see Gaps) — a user's first `Calendar` ("My Calendar") is lazily auto-provisioned server-side the first time they create an event without picking one.
- Sidebar content for the calendar shell: **mini month picker only** (confirmed) — no upcoming-events list, no calendar-list toggle.
- Views: Day / Week / Month, each its own lazy-loaded child route, sharing one `CalendarStateService` instance scoped to the `/calendar` route subtree.
- `angular-calendar`'s `CalendarModule.forRoot()` is a classic NgModule (`.forRoot()` pattern), which this codebase otherwise avoids entirely (standalone-only elsewhere) — kept isolated: imported only inside `calendar.routes.ts`, provided via `importProvidersFrom()` on the shell route's own `providers` (a route-level environment injector, Angular 14.2+), and lazy-loaded as a whole so `angular-calendar`/`date-fns` never touch the main bundle (`app.routes.ts` itself is part of the main bundle, so a top-level import there would NOT be lazy — this is why `calendar.routes.ts` exists as its own file).
- Event **Category** is a flat, non-hierarchical taxonomy (`CalendarCategory` — e.g. "Meeting", "Personal", "Holiday"), deliberately **separate** from the existing `Category` model used by Project/Metric (which has a parent/child tree — a different concept).
- Recurrence is a **structured rule** (`RecurringRule`: frequency/interval/byWeekday/count/until), not a raw iCalendar RRULE string. Expanding it into actual occurrence instances for a given date range is done in-memory, server-side, per request (`backend/utils/recurrence.ts`'s `generateOccurrences()`) — not materialized into rows, not a raw-SQL/CTE approach. `EventException` (`action: skip | modified`) layers per-occurrence exceptions on top: skipping an occurrence just omits it from generation output; editing "this occurrence only" points the exception at a second, full `CalendarEvent` row (its own title/time/guests/etc., `recurrenceId`/`sequenceId` both null) reusing the master's whole access-control/include machinery instead of re-modeling relational data as JSON.
- Meeting link reuses the exact scalar-field shape + `MeetingPlatform` enum + `detectMeetingPlatform()` util already built for `ProjectItem`, rather than inventing a new shape.
- `Attachment` (existing model) was extended with a nullable `calendarEventId` FK instead of creating a second, colliding attachment model.

## 2. Data model (Postgres / Prisma)

`backend/prisma/schema/calendarEvent.prisma`:

- **`Calendar`** — `id, sequenceId, name, color, ownerId, organizationId, createdById, updatedById, createdAt, updatedAt`. One owner, many events.
- **`CalendarCategory`** — `id, name, color, organizationId, createdById, updatedById, createdAt, updatedAt`. `@@unique([organizationId, name])`.
- **`RecurringRule`** — `id, frequency (RecurrenceFrequency: daily/weekly/monthly/yearly), interval, byWeekday (Int[], 0=Sun..6=Sat), count, until, createdAt, updatedAt`. 1:1 with `CalendarEvent` (FK lives on `CalendarEvent.recurrenceId`). Recurrence ends when EITHER `count` or `until` is reached; both null = never ends.
- **`Guest`** — `id, eventId, userId (nullable — null = external invitee known only by email), email, name, rsvp (GuestRsvpStatus: pending/accepted/declined/tentative), invitedAt, respondedAt`. `@@unique([eventId, email])`.
- **`EventReminder`** — `id, eventId, method (ReminderMethod: notification/email), minutesBefore, createdAt`.
- **`CalendarEvent`** — `id, sequenceId, organizationId, title, description, location, start, end, allDay, color (per-event override, falls back to category color in the UI when null), categoryId, ownerId, calendarId, meetingLinkUrl, meetingLinkTitle, meetingLinkPlatform, visibility (EventVisibility: standard/private/public), busyStatus (EventBusyStatus: busy/free), recurrenceId, createdById, updatedById, createdAt, updatedAt`. Plus `guests[]`, `attachments[]`, `reminders[]`.
- `attachment.prisma` — added nullable `calendarEventId` + `calendarEvent` relation (`onDelete: Cascade`), indexed.
- `sequence.prisma` — `calendar` and `calendarEvent` added to `SequenceEntity` (each org has its own per-entity sequence counter via `nextSequenceId()`).
- Reverse relations added to `organization.prisma` / `user.prisma`.

Migrations: `20260801000000_add_calendar_sequence_entities`, `20260801010000_add_calendar_events`, `20260801020000_add_attachment_calendar_event`, `20260802000000_add_event_exceptions`.

- **`EventException`** — `id, eventId (FK→CalendarEvent master, cascade), originalStart (the pattern slot being overridden), action (ExceptionAction: skip/modified), overrideEventId (Int? @unique, FK→CalendarEvent, cascade)`. `@@unique([eventId, originalStart])`. `CalendarEvent` gained the reverse relations `exceptions[]` (master side) and `exceptionOverrideFor` (override-row side — used to reject the generic `/:eventId` routes from being hit directly on an override row).

## 3. Backend API

### Events — `backend/controllers/eventController.ts`, mounted at `/api/events` (`backend/routes/eventRoutes.ts`)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Paginated (`page`/`limit`, max 200), filters: `start`, `end` (interval-overlap: `event.start <= end AND event.end >= start`), `search` (title/description/location, insensitive), `calendarId`, `categoryId`. Non-Admins are scoped to events they own, are a guest on, or that are `public`. When both `start`/`end` are given, recurring masters are expanded into individual occurrences via `generateOccurrences()` (skip/modified exceptions applied) and merged with plain events, sorted by start; **pagination/`total`/`totalPages` describe the raw matched rows, not the expanded occurrence count** — deliberate, holds only as long as the calendar grid keeps requesting one bounded visible range per call rather than paginating through occurrences. |
| POST | `/` | `validateEvent`. Auto-provisions the user's default `Calendar` if `calendarId` omitted. |
| GET | `/:eventId` | `validateEventId`. 404s if this id is actually an occurrence override row (`exceptionOverrideFor` set) — use the occurrence routes instead. |
| PUT | `/:eventId` | `validateEventId` + `validateEvent`. Guests/reminders are **full-replace** (client sends the whole desired list back, same convention as `Project.tags`), recurrence is create/update/delete as needed; turning a recurring event back into a plain one (`recurrence: null`) also cleans up any `EventException`/override rows first. Same override-row 404 guard as GET. |
| DELETE | `/:eventId` | Deletes any `modified`-exception override rows (+ their attachment blobs) first, then the master (cascades remaining `skip`-only exceptions). Same override-row 404 guard as GET. |
| GET/PUT/DELETE | `/:eventId/occurrences/:originalStart` | Per-occurrence exceptions to a recurring event — `originalStart` (URL-encoded ISO timestamp) identifies which generated slot is targeted, validated against a fresh `generateOccurrences()` call before any exception is created. GET returns the merged (master + override, if any) full-detail view. PUT upserts an override `CalendarEvent` row + a `modified` exception — edits just this occurrence. DELETE upserts a `skip` exception (deleting any prior override row) — removes just this occurrence, leaving the rest of the series untouched. `validateOccurrenceParams` in `validate.ts` guards the params. |

Access control (plain exported functions, not middleware — same pattern used elsewhere in this codebase):
```ts
canAccessEvent(user, event) // owner, invited guest, 'public' visibility, or Admin
canEditEvent(user, event)   // owner or Admin only
```

### Calendar Categories — `backend/controllers/calendarCategoryController.ts`, mounted at `/api/calendar-categories` (`backend/routes/calendarCategoryRoutes.ts`)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Flat list, org-scoped, no pagination (only ever backs a `<select>`/color list). |
| POST | `/` | Open to any authenticated user (not role-gated) — mirrors `tagRoutes.ts`, since anyone creating an event may need a new category inline. Case-insensitive duplicate-name check within the org. |
| PUT | `/:id` | Admin/Manager only. |
| DELETE | `/:id` | Admin/Manager only. `CalendarEvent.categoryId` has no `onDelete` override (nullable FK defaults to `SetNull`), so events just lose their category rather than the delete being blocked. |

### Validation — `backend/middleware/validate.ts`

`validateEventId`, `validateEvent` (title/start/end required on POST, hex color, id checks for category/calendar, visibility/busyStatus whitelists, URL check for meeting link, guests array shape incl. email regex, reminders array shape, recurrence object shape incl. frequency whitelist/interval/byWeekday/count/until), `validateCalendarCategoryId`, `validateCalendarCategory` (name required on POST, hex color).

## 4. Frontend

### Models & services

- `frontend/src/app/models/event.model.ts` — `CalendarEventModel` (full shape), `CalendarEventListItem` (lighter — no full guest `user` join, no attachments/reminders/recurrence, mirrors the backend's list-vs-detail include split), `CalendarOccurrence` (wraps `CalendarEventListItem` with `isRecurring`/`originalStart`/`isException` — what `GET /events` actually returns now, one entry per occurrence, `id` always the master's), `Guest`, `EventReminder`, `RecurringRule`, `EventCalendarLite`, `EventCategoryLite`, `GuestInput`/`ReminderInput`/`RecurrenceInput`, `CreateEventPayload`/`UpdateEventPayload`, `EventListFilters`, `PaginatedEvents`.
- `frontend/src/app/core/services/event.service.ts` — `getEvents()`, `getEventById()`, `createEvent()`, `updateEvent()`, `deleteEvent()`, `searchEvents()` (thin wrapper over `getEvents()`), `getEventsBetween()` (thin wrapper, what the calendar grid actually uses), `duplicateEvent()` (client-side copy-then-`createEvent()`, not a dedicated backend endpoint), `getOccurrence()`/`updateOccurrence()`/`skipOccurrence()` (occurrence-scoped routes, `originalStart` URL-encoded).
- `frontend/src/app/models/calendar-category.model.ts` + `frontend/src/app/core/services/calendar-category.service.ts` — `getCategories()`/`createCategory()`/`updateCategory()`/`deleteCategory()`.

### Routing

Lazy top-level route in `app.routes.ts`:
```ts
{ path: 'calendar', canActivate: [authGuard], loadChildren: () => import('./pages/calendar/calendar.routes').then(m => m.CALENDAR_ROUTES) }
```
`frontend/src/app/pages/calendar/calendar.routes.ts` — shell route (`''`, carries the `CalendarModule.forRoot()` provider) with children `day` / `week` / `month` (default redirect → `month`), each its own lazy-loaded component.

### Shell — `frontend/src/app/pages/calendar/calendar.component.ts/html/css`

- Toolbar: mobile sidebar toggle, Today/Prev/Next, range label (`CalendarStateService.rangeLabel()`), loading spinner, **Create Event** button, Day/Week/Month view switcher.
- Responsive sidebar: mini month picker (`app-mini-month-picker`, thin `ngb-datepicker` wrapper) + mobile slide-in toggle/backdrop.
- `<router-outlet>` for the active Day/Week/Month child.
- Renders `<app-event-detail-dialog>` once, bound entirely to `CalendarStateService` signals.
- Error banner for event-fetch failures.

### `CalendarStateService` (`frontend/src/app/core/services/calendar-state.service.ts`)

Provided per-instance on the shell route (not `providedIn: 'root'`), shared by the shell and whichever Day/Week/Month child is routed in — mirrors the `DropListRegistryService` component-scoped-service pattern used elsewhere in this app.

- `viewDate` / `viewMode` (day/week/month) / `rangeLabel` (computed, date-fns formatted per mode).
- `events` / `eventsLoading` / `eventsError`, auto-refetched via an `effect()` whenever `viewDate`/`viewMode` change, using `getEventsBetween()` over each mode's visible range (month mode pads to the full 6-week grid `mwl-calendar-month-view` actually renders). `events` holds `CalendarOccurrence[]` — one entry per occurrence, already expanded server-side.
- `mwlEvents` (computed) — maps fetched occurrences to the shape `mwl-calendar-*-view` expects, color falling back `event.color → event.category?.color → calendar.color → default blue`. Each grid item's `id` is a synthetic `` `${event.id}:${event.originalStart}` `` (one master can now produce many grid items in the same response, so the master id alone isn't unique); `meta` carries the full occurrence.
- `today()` / `next()` / `prev()` / `setViewDate()` / `setViewMode()` / `refreshEvents()`.
- Dialog-driving state: `selectedEventId`, `selectedOriginalStart` (set only when the clicked item is one instance of a recurring series), `dialogMode` ('create'/'edit'/'view'), `createRangeStart`/`createRangeEnd`, `dialogOpen` (computed), `openEventDetail(id, originalStart?)`, `openCreateEvent(range?)`, `closeEventDetail()`.

### Day / Week / Month views (`day-view/`, `week-view/`, `month-view/`)

Each is a thin wrapper: `ngOnInit()` calls `state.setViewMode(...)`, template binds `[viewDate]`/`[events]` to the shared state and `(eventClicked)` → `state.openEventDetail(event.meta.id)`. Month view additionally handles `(dayClicked)` by re-centering `viewDate` on the clicked day (does not switch to day view or open create — matches how most calendar apps' month grid behaves).

### `EventDetailDialogComponent` (`frontend/src/app/shared/event-detail-dialog/`)

One dialog, three modes — not a separate viewer + form:

- `@Input() open`, `mode: 'create'|'edit'|'view'`, `eventId`, `originalStart` (set only when the parent clicked one instance of a recurring series — routes loading/saving/deleting to the occurrence-scoped endpoints instead of the master's), `initialStart`/`initialEnd` (create-mode prefill, e.g. from a clicked day cell — defaults to "now +1h" if omitted).
- `@Output() closed`, `saved`, `deleted`.
- Internally tracks its own `internalMode`, independent of the `mode` input — in **view** mode, an **Edit** button (owner/Admin only) flips `internalMode` to `'edit'` in place using the already-loaded data, no re-fetch/re-open needed.
- **Recurring-occurrence editing/deleting**: when `originalStart` is set and the loaded event has a `recurrence` (`isRecurringOccurrenceContext`), Save/Delete first show an inline "This event" / "All events" prompt (local modal state in this component, not a shared component — the choice is specific to this dialog's save/delete flow) before dispatching to `updateOccurrence()`/`skipOccurrence()` ("This event") or the existing series-level `updateEvent()`/`deleteEvent()` ("All events"). Two-way only — no "this and following," which would need a series-split semantic and wasn't asked for.
- **View mode**: read-only — time range (all-day/multi-day aware), category, recurrence label (e.g. "Every 2 weeks, until Aug 1" / "Every day, 5 times"), location, meeting link, description, guest pills, visibility/busy-status/owner. Footer: Delete (owner/Admin), Duplicate (anyone who can see it), Edit (owner/Admin).
- **Create/Edit mode**: full form for Title, Description, Location, Start/End (`app-date-picker` + `app-time-picker`, time pickers hidden when All Day is checked), All Day, Color (swatch + hex text, synced), Category (`<select>`, populated from `CalendarCategoryService.getCategories()`), Repeat (checkbox → frequency/interval + Never-ends/Ends-on-date/Ends-after-N-occurrences), Reminders (add/remove rows, method + minutes-before), Guests (email + optional name → chip, dedup by email, remove via ×), Meeting Link (+ title, disabled until a URL is entered), Visibility (select), Busy/Free (toggle buttons). Footer: Cancel, Save; Delete also shown when editing an existing event.
- Date+time combination for the payload: `dayjs(date + time)` → ISO string when not all-day, `dayjs(date).startOf('day')` when all-day.

## 5. Known gaps (not built, not asked for yet — disclosed, not silently skipped)

- **No Calendar (the container, not events) management UI/endpoints** — users can't rename/recolor/create additional named calendars, or pick one when creating an event. The dialog doesn't expose a Calendar field (it wasn't in the requested field list), and the backend silently uses/creates "My Calendar".
- **Editing a series' recurrence pattern (frequency/interval/byWeekday) after exceptions exist can orphan those exceptions** — their `originalStart` may no longer match any newly-generated slot. Same failure mode real calendar apps have; not migrated.
- **Only two-way scope ("this occurrence" / "entire series")** — no Google-Calendar-style "this and following," which would need a series-split exception semantic. Not built since it wasn't asked for.
- **`getEvents`'s pagination describes raw matched rows, not expanded occurrences** — correct only as long as the calendar grid keeps requesting one bounded visible range per call; an unbounded agenda/list view spanning years would need this revisited.
- **No guest RSVP flow** — `Guest.rsvp` exists and defaults to `pending`, but there's no endpoint or UI for a guest to accept/decline/mark tentative. When this lands, it needs to consider an overridden occurrence's own guest list separately from the master's.
- **No attachment upload endpoint for events** — the `Attachment` model supports it (`calendarEventId`), but nothing calls it yet; `deleteEvent`'s blob cleanup (now extended to occurrence override rows too) is defensive for when this lands, not because it's reachable today.
- **No reminder delivery mechanism** — reminders are stored (method + minutes-before) but nothing schedules/sends them, including for occurrence overrides.
- **No search/filter UI on the calendar itself** — `searchEvents()`/`categoryId`/`calendarId` filters exist on the service and controller but aren't wired to any visible search box or filter control in the shell.
- Not exercised against a live database or browser in this session (`backend/.env` isn't present here) — occurrence expansion/exceptions above are verified by `tsc --noEmit` (backend) and `ng build` dev+prod (frontend) passing clean, plus manual tracing, not by clicking through it against real data.
