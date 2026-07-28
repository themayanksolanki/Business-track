# Meet Hub — Integrated Meetings Feature

Enhances the existing chat call feature into a full "Google Meet / Teams"-style meeting
system: calls for 1:1 chat and (new) groups, plus scheduled/instant meetings linked to
Calendar Events and Projects, with a real in-app meeting room (not just a pasted external
link).

This spec is grounded in the current codebase (audited 2026-07-27). Sections marked
**EXISTS** are already built and should be reused/extended, not rebuilt.

---

## Implementation status (as of 2026-07-28)

**Build phases 1–2 (below, §5) are implemented**: the WebRTC extraction into a shared
`WebrtcPeerService`, and the `Meeting`/`MeetingParticipant`/`MeetingSettings` model + REST API
+ Socket.IO room signaling + a standalone Meet Hub UI (`/meet-hub`, `/meet/:roomCode`).
Phases 3–7 (Calendar/Project linkage, Group chat, Group meetings, SFU) are **not started**.
✅/⬜ markers throughout this doc show exactly what shipped vs. what's still spec-only.

Adaptations made during implementation (differ from the sketch below):
- New Prisma models use `Int @id @default(autoincrement())` + `sequenceId`/`SequenceEntity`,
  matching the codebase's real convention — not `String @id @default(cuid())` as drafted below.
- `Meeting` reuses the existing `CallType` enum instead of defining a new one.
- `calendarEventId`/`projectId`/`groupId`/`dmWithUserId` were intentionally left off `Meeting`
  — they'll be added as nullable FKs when Phases 3/4/6 actually start, per the "no
  speculative build-out" guidance.

---

## 0. Current state (what already exists)

- **1:1 calling** is fully implemented end-to-end:
  - Signaling: `backend/socket.ts` (`call:request/accepted/rejected/ended/offer/answer/ice-candidate/mute`)
  - ICE/STUN/TURN config: `GET /api/chat/ice-servers` (`backend/controllers/chatController.ts`)
  - Client WebRTC peer logic lives inline in `frontend/src/app/pages/chat/chat.component.ts` (native `RTCPeerConnection`, one peer per call)
  - Call history persisted as `Message` rows (`type: 'call'`, `callType`, `callStatus`, `callDuration`)
- **No group chat / chat-group model exists.** The only "Group" in the schema is `ProjectItemType.group`, a Kanban section inside a Project — unrelated to chat/meetings.
- **No Conversation model.** `Message` is strictly peer-to-peer (`senderId`/`receiverId`), no `conversationId`.
- **Calendar/Events are the newest, most complete surface**: `Calendar` → `CalendarEvent` → `Guest`/`RecurringRule`/`EventReminder`/`EventException` (`backend/prisma/schema/calendarEvent.prisma`). Events already carry `meetingLinkUrl/Title/Platform`, but this is explicitly just a **pasted external link** (Zoom/Meet/Teams/Webex), not a hosted room.
- **Projects have no relation to CalendarEvents** today.
- **No SFU / group-call media server** and no third-party video SDK (no LiveKit, Agora, Twilio, Daily, Jitsi, mediasoup). Everything today is native browser WebRTC, mesh-style, 1:1 only.
- Auth: JWT access token, verified identically over REST (`protect` middleware) and at the Socket.IO handshake (`socket.ts`) — the meeting-room token scheme should follow this same pattern.

**Implication:** this feature needs three things the codebase doesn't have yet — (1) a
Group/Conversation concept, (2) a real `Meeting` entity independent of a single calendar
event, and (3) multi-party media (mesh works up to ~4 people; beyond that we need an SFU).

---

## 1. Scope & product shape

| Entry point | Behavior | Status |
|---|---|---|
| 1:1 chat → call button | **EXISTS** — instant call, upgrade path: same flow, no change needed except reusing the new `Meeting` record for history/analytics consistency | ⬜ Not done — WebRTC internals now go through `WebrtcPeerService`, but call history still logs via `Message`/`call:*` events, not yet unified onto `Meeting` |
| Group chat → call button | New: instant group meeting, all group members notified, join as they come online | ⬜ Not started — blocked on Group chat (Phase 5) |
| Calendar Event → "Add meeting" | New: event gets a hosted Meet Hub room instead of (or alongside) a pasted link; "Join" button appears on the event when it's near start time | ⬜ Not started (Phase 3) |
| Project → "Schedule meeting" | New: creates a CalendarEvent (linked to the project) + a Meeting room; shows on project's activity/timeline | ⬜ Not started (Phase 4) |
| Meet Hub standalone ("New meeting" like Google Meet) | New: instant ad-hoc room, shareable link/code, optional scheduling for later | ✅ Done — instant room + shareable `/meet/:roomCode` link shipped; API accepts `scheduledStart`/`scheduledEnd` but no UI exposes scheduling yet |

---

## 2. Data model changes (Prisma)

### 2.1 New: `Group` (chat groups) — required prerequisite

**Status: ⬜ Not started** — out of scope for the current build; deferred with Phase 5 per
user decision (treated as a separate future effort, not an in-scope prerequisite).

```prisma
model Group {
  id             String        @id @default(cuid())
  name           String
  avatarUrl      String?
  organizationId String
  createdById    String
  organization   Organization  @relation(fields: [organizationId], references: [id])
  createdBy      User          @relation("GroupCreator", fields: [createdById], references: [id])
  members        GroupMember[]
  messages       GroupMessage[]
  meetings       Meeting[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
}

model GroupMember {
  id        String   @id @default(cuid())
  groupId   String
  userId    String
  role      GroupMemberRole @default(member) // admin/member
  joinedAt  DateTime @default(now())
  group     Group    @relation(fields: [groupId], references: [id])
  user      User     @relation(fields: [userId], references: [id])
  @@unique([groupId, userId])
}

enum GroupMemberRole {
  admin
  member
}
```

Also add `GroupMessage` (mirrors `Message` fields but with `groupId` instead of
`receiverId`, and a `GroupMessageRead` join table for per-member read receipts) — needed
so group calls have a group chat to launch from. This is a big enough sub-feature that it
could ship first, independently, before meetings (see Phase plan below).

### 2.2 New: `Meeting` — the core entity

**Status: ✅ Done** — shipped in `backend/prisma/schema/meeting.prisma`, adapted to the
codebase's real `Int @id @default(autoincrement())` + `sequenceId` convention (not the
`cuid()` shape drafted below) and reusing the existing `CallType` enum instead of a new one.
`calendarEventId`/`projectId`/`groupId`/`dmWithUserId` were intentionally left off — added
when Phases 3/4/6 start.

```prisma
model Meeting {
  id              String        @id @default(cuid())
  roomCode        String        @unique          // short shareable code, e.g. "abc-defg-hij"
  title           String?
  hostId          String
  organizationId  String
  status          MeetingStatus @default(scheduled) // scheduled/live/ended/cancelled
  scheduledStart  DateTime?
  scheduledEnd    DateTime?
  startedAt       DateTime?
  endedAt         DateTime?

  // Linkage — all optional, a meeting can stand alone (ad-hoc "New meeting")
  calendarEventId String?       @unique
  projectId       String?
  groupId         String?
  // 1:1 origin (upgraded chat call) — keep nullable, reuse existing Message call-log too
  dmWithUserId    String?

  calendarEvent   CalendarEvent? @relation(fields: [calendarEventId], references: [id])
  project         Project?       @relation(fields: [projectId], references: [id])
  group           Group?         @relation(fields: [groupId], references: [id])
  host            User           @relation("MeetingHost", fields: [hostId], references: [id])
  organization    Organization   @relation(fields: [organizationId], references: [id])

  participants    MeetingParticipant[]
  settings        MeetingSettings?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum MeetingStatus {
  scheduled
  live
  ended
  cancelled
}

model MeetingParticipant {
  id           String    @id @default(cuid())
  meetingId    String
  userId       String
  joinedAt     DateTime?
  leftAt       DateTime?
  role         MeetingParticipantRole @default(attendee) // host/co-host/attendee
  invited      Boolean   @default(true)                  // false = joined via link, not invited
  meeting      Meeting   @relation(fields: [meetingId], references: [id])
  user         User      @relation(fields: [userId], references: [id])
  @@unique([meetingId, userId])
}

enum MeetingParticipantRole {
  host
  coHost
  attendee
}

model MeetingSettings {
  id                 String  @id @default(cuid())
  meetingId          String  @unique
  waitingRoomEnabled Boolean @default(false)
  allowGuestJoin     Boolean @default(true)   // via link, org members not pre-invited
  muteOnEntry        Boolean @default(false)
  recordingEnabled   Boolean @default(false)
  meeting            Meeting @relation(fields: [meetingId], references: [id])
}
```

### 2.3 Modify existing models

**Status: ⬜ Not started (all three)** — deferred to Phases 3/4, which need the
`CalendarEvent`/`Project` linkage; `Notification.type` additions land alongside whichever
phase first fires a meeting notification.

- `CalendarEvent`: add optional back-reference `meeting Meeting?` (via the `calendarEventId` FK above) and, separately, add `projectId String?` + `project Project? @relation(...)` — **this is the missing Project↔Calendar link** noted in section 0, needed so "Project → Schedule meeting" can show on the calendar and "Calendar event → linked project" can show on the project timeline. Keep `meetingLinkUrl/Title/Platform` as-is for backwards compatibility with pasted external links (Zoom/Teams for people not ready to switch); a `CalendarEvent` can have *either* a pasted link *or* a hosted `Meeting`, or neither.
- `Project`: add `calendarEvents CalendarEvent[]` and `meetings Meeting[]` relations.
- `Notification`: extend the `type` enum with `meetingInvited`, `meetingStarting`, `meetingCancelled`, `meetingReminder`.

---

## 3. Backend

### 3.1 REST — `backend/routes/meetingRoutes.ts` (new, mount at `/api/meetings`)

**Status: ✅ Done (all 9 routes)**, scoped down to standalone/ad-hoc meetings — no
`projectId`/`groupId`/`calendarEventId`/`dmWithUserId` on create (Phase 3/4/6 territory), no
auto-created `CalendarEvent`, and `/upcoming` isn't wired into a dashboard widget/banner yet
(§4.2 is still ⬜).

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/` | Create meeting (instant or scheduled). Body accepts optional `projectId`/`groupId`/`calendarEventId`/`dmWithUserId` + `scheduledStart/End`. Auto-creates a `CalendarEvent` if scheduled and none supplied. | ✅ Done, minus the linkage fields and calendar auto-create |
| GET | `/:roomCode` | Resolve room code → meeting details + auth check (org member, invited, or `allowGuestJoin`) | ✅ Done |
| POST | `/:id/join` | Validate & issue short-lived **room token** (JWT, ~2 min TTL) scoped to `meetingId` + `userId`, used for socket handshake into the room namespace. Mirrors existing `protect` JWT pattern. | ✅ Done |
| POST | `/:id/end` | Host/co-host ends meeting for everyone | ✅ Done (no UI button wired to it yet — see §4.1) |
| POST | `/:id/leave` | Self leave | ✅ Done |
| PATCH | `/:id` | Update settings/title/schedule (host only) | ✅ Done |
| DELETE | `/:id` | Cancel a scheduled meeting (notifies invitees, removes calendar event if auto-created) | ✅ Done, minus the invitee notification (Notification model untouched, §2.3) |
| GET | `/upcoming` | List current user's upcoming meetings (dashboard widget + "Join now" banner) | ✅ Done as an API; ⬜ not surfaced on the dashboard, only in the Meet Hub landing page |
| GET | `/:id/history` | Participant list with join/leave timestamps, duration | ✅ Done |

Reuse `authMiddleware.protect` on all routes. Authorization checks (who can join/end/edit)
follow the same `canAccessCalendar`/`canAccessEvent` pattern already used in
`calendarController`/`eventController`.

### 3.2 Real-time — extend `backend/socket.ts`

**Status: ✅ Done** for the core join/leave/signal/mute/video-toggle path (first use of native
Socket.IO rooms in this codebase — confirmed no prior usage). **⬜ Not done**: screen-share,
hand-raise, in-room chat, host kick, and the `notification:new`/BullMQ reminder pipeline (all
called out below as explicitly deferred, not silently dropped).

Add a **room-scoped namespace/pattern** rather than reusing the flat 1:1 call events,
since group meetings need N-way state:

- `meeting:join` (room token) → server validates, adds to `Map<meetingId, Set<socketId>>`, joins the socket to a Socket.IO room `meeting:{id}`, broadcasts `meeting:participant-joined` to the room. ✅ Done (tracked via `meetingSocketUsers` + native room membership rather than a separate `Set<socketId>` map, but same effect) — capped at 4 participants per the mesh-scaling note below.
- `meeting:leave` / disconnect → broadcast `meeting:participant-left`, update `MeetingParticipant.leftAt`, end meeting if host leaves and no co-host (configurable) or if last participant leaves. ✅ Done for leave/disconnect broadcast; ⬜ auto-ending when the host leaves or the room empties is explicitly deferred (documented as a Phase 2 non-goal to avoid socket/REST race conditions).
- WebRTC signaling becomes **room-relayed** instead of 1:1 direct: `meeting:signal` `{ toSocketId, sdp | candidate }` — server just relays to the target socket within the room (mesh topology, each pair negotiates directly). This is a straightforward generalization of the existing `call:offer/answer/ice-candidate` handlers — same shape, targeted at N peers instead of 1. ✅ Done, including ICE candidate relay (caught and fixed in review — the first pass shipped without it).
- `meeting:mute`, `meeting:video-toggle` ✅ Done. `meeting:screen-share-start/stop`, `meeting:hand-raise`, `meeting:chat-message` (in-room ephemeral chat, separate from persisted Group/DM chat), `meeting:kick` (host only), `meeting:end` ⬜ Not done — `meeting:end` exists as a REST action (`POST /:id/end`) instead of a socket event; the rest are unbuilt.
- Reuse existing `notification:new` pipeline for `meeting:invited`/`meeting:starting` (fire 5 min before `scheduledStart` via the existing BullMQ/ioredis job queue — already a dependency, currently unused for this but a natural fit for scheduled reminders, similar to how `EventReminder` presumably should trigger today). ⬜ Not done.

**Mesh vs SFU decision point:** native mesh WebRTC (what's already built for 1:1) scales
poorly past ~4-5 participants (each client uploads N-1 streams). Recommend:
- **Phase 1**: cap group meetings at 4 participants, ship with mesh (zero new infra, reuses 100% of existing WebRTC client code path). ✅ Done — `MEETING_ROOM_CAPACITY = 4` enforced server-side in `meeting:join`.
- **Phase 2** (if usage demands larger meetings): introduce an SFU. Cheapest paths given zero existing video infra: self-hosted **mediasoup** (more backend work, full control, no per-minute cost) or a hosted SDK (**LiveKit Cloud** or **Daily.co** — fastest to integrate, per-minute billing). This is a build-vs-buy call to make with the user once Phase 1 ships and real usage/participant-count data exists — don't pre-build it speculatively. ⬜ Not started — correctly deferred, no usage data yet.

### 3.3 Recording (optional, later phase)

**Status: ⬜ Not started** — `MeetingSettings.recordingEnabled` column exists but nothing
reads/acts on it yet.

`MeetingSettings.recordingEnabled` — if pursued, requires either client-side
`MediaRecorder` + upload to existing S3/Cloudinary pipeline (works for mesh, no server
media processing) or server-side recording (only feasible once on an SFU). Client-side is
the pragmatic Phase 1/2 answer.

---

## 4. Frontend (Angular)

### 4.1 New feature module: `frontend/src/app/pages/meet-hub/`

- `meet-hub.component.ts` — landing view: "New meeting" (instant), "Join with code", "Upcoming meetings" list (calls `GET /api/meetings/upcoming`). ✅ Done.
- `meeting-room/meeting-room.component.ts` — the actual in-call UI: video tile grid, mute/camera/screen-share/leave controls, participant list, in-room chat panel, raise-hand. **Extract the WebRTC peer logic currently inline in `chat.component.ts` (lines ~778-965) into a shared `WebrtcPeerService`** so both the 1:1 chat call and the new N-way meeting room use the same peer-connection/media-stream primitives instead of duplicating them. This refactor is worth doing regardless of meetings, and de-risks the group-call work. — ✅ **Done**: video tile grid, mute/camera/leave controls, and the `WebrtcPeerService` extraction (actual pre-refactor line range was ~770-959, not 778-965) are all shipped. ⬜ **Not done**: screen-share, a dedicated participant-list panel (tiles double as the list), in-room chat panel, raise-hand.
- `meeting-lobby/meeting-lobby.component.ts` — pre-join screen (camera/mic preview + device picker + "Ask to join" if waiting room enabled), matches the Google Meet mental model the user referenced. — ✅ **Done**: camera/mic preview + mute/camera toggle before joining. ⬜ **Not done**: device picker (camera/mic selection dropdown — confirmed no prior art anywhere in the frontend) and the "Ask to join" waiting-room flow (`MeetingSettings.waitingRoomEnabled` exists but is inert).
- Service: `core/services/meeting.service.ts` (REST calls) + extend `socket.service.ts` with the new `meeting:*` event subjects, following the existing `callIncoming$`/`callOffer$` pattern. ✅ Done.
- Route: `/meet/:roomCode` (shareable/joinable link, guarded — prompts login if not authenticated, then drops into lobby). ✅ Done, guarded by `authGuard` (redirects to login if unauthenticated, same as every other authenticated route — no separate guest-join flow was built).

### 4.2 Integration touch points (reusing existing UI, not new pages)

**Status: ⬜ Not started (all of §4.2)** — Meet Hub currently only exists as its own
standalone area; none of the existing pages below have been touched to surface it.

- **Chat** (`pages/chat/chat.component.ts`): existing call button stays for 1:1 (no behavior change to the user); internally it now creates a `Meeting` row via the service instead of only socket signaling, so call history and meeting history are unified in the `Meeting`/`MeetingParticipant` tables going forward (existing `Message`-based call log can remain read-only/legacy for old records). ⬜ Not done — the chat call button still only does 1:1 socket signaling, no `Meeting` row.
- **Group chat** (new, once Group model ships): same call button, creates a group `Meeting`. ⬜ Not started (blocked on Group chat).
- **Calendar** (`pages/calendar/`, `shared/calendar-form/`): add a "Meeting" toggle/section in the event create/edit dialog — "Add Meet Hub room" (creates a `Meeting` + fills `meetingLinkUrl` with the internal `/meet/:roomCode` link) as an alternative to "Paste external link." Event detail popover gets a prominent "Join" button that activates ~5 min before `start`. ⬜ Not started (Phase 3).
- **Projects** (`pages/project-detail/`): add "Schedule meeting" action near existing project actions (mirrors `move-to-project-dialog` style), opens the calendar-form pre-scoped to `projectId`; project detail view gets an "Upcoming/past meetings" panel similar to `project-teams`. ⬜ Not started (Phase 4).
- **Notifications** (`shared/notification-bell/`, `notifications-feed.service.ts`): render new `meetingInvited`/`meetingStarting` types with a "Join" quick action. ⬜ Not started (depends on §2.3's `Notification.type` extension).
- **Dashboard** (`pages/dashboard`): optional "Join now" banner if a meeting the user is invited to is starting within N minutes — same pattern likely already used for task due-date nudges, check `dashboard.component.ts` for an existing banner pattern to match. ⬜ Not started — and confirmed there's no existing due-date "banner"/"nudge" pattern in `dashboard.component.ts` to mirror (only a static welcome banner and an "Overdue" stat tile), so this would be new UI, not a port of an existing pattern.

---

## 5. Suggested build phases

1. ✅ **Done** — **Refactor WebRTC into `WebrtcPeerService`** (no behavior change) — de-risks everything after it. Small, isolated, testable against existing 1:1 call.
2. ✅ **Done** — **`Meeting` model + REST + instant ad-hoc meetings** (no groups/calendar/project yet) — ships the "New meeting, share link, join" Google-Meet-style flow standalone, reusing 1:1-capable mesh WebRTC. Validates room/token/socket-namespace design end-to-end with the smallest scope.
3. ⬜ **Not started** — **Calendar integration** — `meetingLinkUrl` alternative, "Join" button on events, `Project↔CalendarEvent` relation.
4. ⬜ **Not started** — **Project integration** — "Schedule meeting" action, project meetings panel.
5. ⬜ **Not started** — **Group chat model** (`Group`/`GroupMember`/`GroupMessage`) — this is its own substantial feature; scope/estimate separately if not already planned elsewhere.
6. ⬜ **Not started** — **Group meetings** — once (5) exists, wire group call button using the same `Meeting`/`WebrtcPeerService` from phase 1-2, capped at ~4 mesh participants.
7. ⬜ **Not started** — **Scale decision**: revisit SFU (mediasoup vs LiveKit/Daily) only if usage data from phases 2-6 shows demand for >4-person meetings.

Phases 1-4 deliver the "meetings connected to calendar and projects" ask without requiring
group chat at all. Phases 5-6 deliver the "group chat calls" piece, which is the largest
net-new subsystem (no group chat exists today) and should be scoped as its own effort.

---

## 6. Open questions for the user

- Is group chat (Phase 5) already planned/tracked elsewhere, or should Meet Hub's plan treat it as an in-scope prerequisite?
- Participant cap comfort for Phase 1-2 mesh calls (recommend 4) vs. willingness to take on SFU infra/cost sooner for larger meetings?
- Recording — needed for v1, or defer?
- External calendar sync (Google Calendar/Outlook) — in scope, or is the existing in-app `Calendar`/`CalendarEvent` the only surface for now?
