# Meet Hub — Integrated Meetings Feature

Enhances the existing chat call feature into a full "Google Meet / Teams"-style meeting
system: calls for 1:1 chat and (new) groups, plus scheduled/instant meetings linked to
Calendar Events and Projects, with a real in-app meeting room (not just a pasted external
link).

This spec is grounded in the current codebase (audited 2026-07-27). Sections marked
**EXISTS** are already built and should be reused/extended, not rebuilt.

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

| Entry point | Behavior |
|---|---|
| 1:1 chat → call button | **EXISTS** — instant call, upgrade path: same flow, no change needed except reusing the new `Meeting` record for history/analytics consistency |
| Group chat → call button | New: instant group meeting, all group members notified, join as they come online |
| Calendar Event → "Add meeting" | New: event gets a hosted Meet Hub room instead of (or alongside) a pasted link; "Join" button appears on the event when it's near start time |
| Project → "Schedule meeting" | New: creates a CalendarEvent (linked to the project) + a Meeting room; shows on project's activity/timeline |
| Meet Hub standalone ("New meeting" like Google Meet) | New: instant ad-hoc room, shareable link/code, optional scheduling for later |

---

## 2. Data model changes (Prisma)

### 2.1 New: `Group` (chat groups) — required prerequisite

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

- `CalendarEvent`: add optional back-reference `meeting Meeting?` (via the `calendarEventId` FK above) and, separately, add `projectId String?` + `project Project? @relation(...)` — **this is the missing Project↔Calendar link** noted in section 0, needed so "Project → Schedule meeting" can show on the calendar and "Calendar event → linked project" can show on the project timeline. Keep `meetingLinkUrl/Title/Platform` as-is for backwards compatibility with pasted external links (Zoom/Teams for people not ready to switch); a `CalendarEvent` can have *either* a pasted link *or* a hosted `Meeting`, or neither.
- `Project`: add `calendarEvents CalendarEvent[]` and `meetings Meeting[]` relations.
- `Notification`: extend the `type` enum with `meetingInvited`, `meetingStarting`, `meetingCancelled`, `meetingReminder`.

---

## 3. Backend

### 3.1 REST — `backend/routes/meetingRoutes.ts` (new, mount at `/api/meetings`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | Create meeting (instant or scheduled). Body accepts optional `projectId`/`groupId`/`calendarEventId`/`dmWithUserId` + `scheduledStart/End`. Auto-creates a `CalendarEvent` if scheduled and none supplied. |
| GET | `/:roomCode` | Resolve room code → meeting details + auth check (org member, invited, or `allowGuestJoin`) |
| POST | `/:id/join` | Validate & issue short-lived **room token** (JWT, ~2 min TTL) scoped to `meetingId` + `userId`, used for socket handshake into the room namespace. Mirrors existing `protect` JWT pattern. |
| POST | `/:id/end` | Host/co-host ends meeting for everyone |
| POST | `/:id/leave` | Self leave |
| PATCH | `/:id` | Update settings/title/schedule (host only) |
| DELETE | `/:id` | Cancel a scheduled meeting (notifies invitees, removes calendar event if auto-created) |
| GET | `/upcoming` | List current user's upcoming meetings (dashboard widget + "Join now" banner) |
| GET | `/:id/history` | Participant list with join/leave timestamps, duration |

Reuse `authMiddleware.protect` on all routes. Authorization checks (who can join/end/edit)
follow the same `canAccessCalendar`/`canAccessEvent` pattern already used in
`calendarController`/`eventController`.

### 3.2 Real-time — extend `backend/socket.ts`

Add a **room-scoped namespace/pattern** rather than reusing the flat 1:1 call events,
since group meetings need N-way state:

- `meeting:join` (room token) → server validates, adds to `Map<meetingId, Set<socketId>>`, joins the socket to a Socket.IO room `meeting:{id}`, broadcasts `meeting:participant-joined` to the room.
- `meeting:leave` / disconnect → broadcast `meeting:participant-left`, update `MeetingParticipant.leftAt`, end meeting if host leaves and no co-host (configurable) or if last participant leaves.
- WebRTC signaling becomes **room-relayed** instead of 1:1 direct: `meeting:signal` `{ toSocketId, sdp | candidate }` — server just relays to the target socket within the room (mesh topology, each pair negotiates directly). This is a straightforward generalization of the existing `call:offer/answer/ice-candidate` handlers — same shape, targeted at N peers instead of 1.
- `meeting:mute`, `meeting:video-toggle`, `meeting:screen-share-start/stop`, `meeting:hand-raise`, `meeting:chat-message` (in-room ephemeral chat, separate from persisted Group/DM chat), `meeting:kick` (host only), `meeting:end`.
- Reuse existing `notification:new` pipeline for `meeting:invited`/`meeting:starting` (fire 5 min before `scheduledStart` via the existing BullMQ/ioredis job queue — already a dependency, currently unused for this but a natural fit for scheduled reminders, similar to how `EventReminder` presumably should trigger today).

**Mesh vs SFU decision point:** native mesh WebRTC (what's already built for 1:1) scales
poorly past ~4-5 participants (each client uploads N-1 streams). Recommend:
- **Phase 1**: cap group meetings at 4 participants, ship with mesh (zero new infra, reuses 100% of existing WebRTC client code path).
- **Phase 2** (if usage demands larger meetings): introduce an SFU. Cheapest paths given zero existing video infra: self-hosted **mediasoup** (more backend work, full control, no per-minute cost) or a hosted SDK (**LiveKit Cloud** or **Daily.co** — fastest to integrate, per-minute billing). This is a build-vs-buy call to make with the user once Phase 1 ships and real usage/participant-count data exists — don't pre-build it speculatively.

### 3.3 Recording (optional, later phase)

`MeetingSettings.recordingEnabled` — if pursued, requires either client-side
`MediaRecorder` + upload to existing S3/Cloudinary pipeline (works for mesh, no server
media processing) or server-side recording (only feasible once on an SFU). Client-side is
the pragmatic Phase 1/2 answer.

---

## 4. Frontend (Angular)

### 4.1 New feature module: `frontend/src/app/pages/meet-hub/`

- `meet-hub.component.ts` — landing view: "New meeting" (instant), "Join with code", "Upcoming meetings" list (calls `GET /api/meetings/upcoming`).
- `meeting-room/meeting-room.component.ts` — the actual in-call UI: video tile grid, mute/camera/screen-share/leave controls, participant list, in-room chat panel, raise-hand. **Extract the WebRTC peer logic currently inline in `chat.component.ts` (lines ~778-965) into a shared `WebrtcPeerService`** so both the 1:1 chat call and the new N-way meeting room use the same peer-connection/media-stream primitives instead of duplicating them. This refactor is worth doing regardless of meetings, and de-risks the group-call work.
- `meeting-lobby/meeting-lobby.component.ts` — pre-join screen (camera/mic preview + device picker + "Ask to join" if waiting room enabled), matches the Google Meet mental model the user referenced.
- Service: `core/services/meeting.service.ts` (REST calls) + extend `socket.service.ts` with the new `meeting:*` event subjects, following the existing `callIncoming$`/`callOffer$` pattern.
- Route: `/meet/:roomCode` (shareable/joinable link, guarded — prompts login if not authenticated, then drops into lobby).

### 4.2 Integration touch points (reusing existing UI, not new pages)

- **Chat** (`pages/chat/chat.component.ts`): existing call button stays for 1:1 (no behavior change to the user); internally it now creates a `Meeting` row via the service instead of only socket signaling, so call history and meeting history are unified in the `Meeting`/`MeetingParticipant` tables going forward (existing `Message`-based call log can remain read-only/legacy for old records).
- **Group chat** (new, once Group model ships): same call button, creates a group `Meeting`.
- **Calendar** (`pages/calendar/`, `shared/calendar-form/`): add a "Meeting" toggle/section in the event create/edit dialog — "Add Meet Hub room" (creates a `Meeting` + fills `meetingLinkUrl` with the internal `/meet/:roomCode` link) as an alternative to "Paste external link." Event detail popover gets a prominent "Join" button that activates ~5 min before `start`.
- **Projects** (`pages/project-detail/`): add "Schedule meeting" action near existing project actions (mirrors `move-to-project-dialog` style), opens the calendar-form pre-scoped to `projectId`; project detail view gets an "Upcoming/past meetings" panel similar to `project-teams`.
- **Notifications** (`shared/notification-bell/`, `notifications-feed.service.ts`): render new `meetingInvited`/`meetingStarting` types with a "Join" quick action.
- **Dashboard** (`pages/dashboard`): optional "Join now" banner if a meeting the user is invited to is starting within N minutes — same pattern likely already used for task due-date nudges, check `dashboard.component.ts` for an existing banner pattern to match.

---

## 5. Suggested build phases

1. **Refactor WebRTC into `WebrtcPeerService`** (no behavior change) — de-risks everything after it. Small, isolated, testable against existing 1:1 call.
2. **`Meeting` model + REST + instant ad-hoc meetings** (no groups/calendar/project yet) — ships the "New meeting, share link, join" Google-Meet-style flow standalone, reusing 1:1-capable mesh WebRTC. Validates room/token/socket-namespace design end-to-end with the smallest scope.
3. **Calendar integration** — `meetingLinkUrl` alternative, "Join" button on events, `Project↔CalendarEvent` relation.
4. **Project integration** — "Schedule meeting" action, project meetings panel.
5. **Group chat model** (`Group`/`GroupMember`/`GroupMessage`) — this is its own substantial feature; scope/estimate separately if not already planned elsewhere.
6. **Group meetings** — once (5) exists, wire group call button using the same `Meeting`/`WebrtcPeerService` from phase 1-2, capped at ~4 mesh participants.
7. **Scale decision**: revisit SFU (mediasoup vs LiveKit/Daily) only if usage data from phases 2-6 shows demand for >4-person meetings.

Phases 1-4 deliver the "meetings connected to calendar and projects" ask without requiring
group chat at all. Phases 5-6 deliver the "group chat calls" piece, which is the largest
net-new subsystem (no group chat exists today) and should be scoped as its own effort.

---

## 6. Open questions for the user

- Is group chat (Phase 5) already planned/tracked elsewhere, or should Meet Hub's plan treat it as an in-scope prerequisite?
- Participant cap comfort for Phase 1-2 mesh calls (recommend 4) vs. willingness to take on SFU infra/cost sooner for larger meetings?
- Recording — needed for v1, or defer?
- External calendar sync (Google Calendar/Outlook) — in scope, or is the existing in-app `Calendar`/`CalendarEvent` the only surface for now?
