# Meet Hub — Integrated Meetings Feature

Enhances the existing chat call feature into a full "Google Meet / Teams"-style meeting
system: calls for 1:1 chat and (new) groups, plus scheduled/instant meetings linked to
Calendar Events and Projects, with a real in-app meeting room (not just a pasted external
link).

This spec is grounded in the current codebase (audited 2026-07-27). Sections marked
**EXISTS** are already built and should be reused/extended, not rebuilt.

---

## Implementation status (as of 2026-07-30)

**Build phases 1–6 (below, §5) are implemented**: the WebRTC extraction into a shared
`WebrtcPeerService`; the `Meeting`/`MeetingParticipant`/`MeetingSettings` model + REST API
+ Socket.IO room signaling + a standalone Meet Hub UI (`/meet-hub`, `/meet/:roomCode`);
Calendar/Project integration — `Meeting.calendarEventId`/`projectId` FKs, `CalendarEvent.projectId`,
`Project.calendarEvents[]`/`meetings[]`, `POST /api/meetings` accepting `calendarEventId`/
`projectId` (with auto-creating a `CalendarEvent` when scheduled and none supplied),
the "Add Meet Hub room" toggle + "Join" button in the event dialog, and the project
detail page's "Schedule Meeting" action + Meetings tab; the Group chat model —
`Group`/`GroupMember`/`GroupMessage`/`GroupMessageRead`, full REST + Socket.IO messaging
(send/edit/delete/pin/typing/read-receipts, no reactions), and a "Groups" tab integrated
into the existing chat page (create group, group thread, manage members); and Group
meetings — `Meeting.groupId`, audio/video call buttons in the group thread header that
create a group-scoped `Meeting` (all current members auto-invited as participants,
`allowGuestJoin` forced off), reusing the exact same mesh/`WebrtcPeerService`/meeting-room
machinery as every other meeting, with both a join-link chat message and a `meetingStarting`
push notification.
Phase 7 (SFU) is **not started** — deliberately deferred, see `remaining-meethub.md` §F
for why.

**Three post-launch polish batches** (all shipped, on top of the phases above — see
`remaining-meethub.md` for the itemized punch-list each one worked through):
1. **Notifications**: `Notification.meetingId`/`groupId` (SetNull on delete), new
   `meetingStarting`/`meetingCancelled`/`groupMemberAdded` types, wired into meeting
   create/cancel and group create/add-members, with click-through navigation.
2. **Meeting room controls**: screen-share, raise-hand, an in-room ephemeral chat panel,
   host-only kick + "End meeting", and a camera/mic device picker in the lobby.
3. **Remaining polish**: Meet Hub "Schedule for later" UI, a dashboard upcoming-meetings
   widget + "Join now" banner, auto-created-`CalendarEvent` cleanup on cancel, and group
   avatar upload.

✅/⬜ markers throughout this doc show exactly what shipped vs. what's still spec-only.

For a consolidated punch-list of everything still outstanding, see **`remaining-meethub.md`**.

### Verified file list (phases 1–2)

Backend:
- `backend/prisma/schema/meeting.prisma` — `Meeting`/`MeetingParticipant`/`MeetingSettings`
- `backend/routes/meetingRoutes.ts` — the 9 REST routes
- `backend/controllers/meetingController.ts`
- `backend/utils/meetingToken.ts` — room-token JWT generation
- `backend/socket.ts` — `meeting:*` Socket.IO event handlers
- `backend/controllers/chatController.ts` — `getIceServers` (via `backend/routes/chatRoutes.ts`)
- No dedicated backend WebRTC peer service — signaling relays entirely through `socket.ts`

Frontend (`frontend/src/app/`):
- `pages/meet-hub/meet-hub.component.ts` / `.html` / `.css`
- `pages/meet-hub/meet-hub.routes.ts`
- `pages/meet-hub/meeting-lobby/meeting-lobby.component.ts` / `.html` / `.css`
- `pages/meet-hub/meeting-room/meeting-room.component.ts` / `.html` / `.css`
- `pages/meet-hub/video-tile/video-tile.component.ts` / `.html` / `.css`
- `core/services/meeting.service.ts` — REST calls
- `core/services/socket.service.ts` — `meeting:*` event subjects
- `core/services/webrtc-peer.service.ts` — the extracted `WebrtcPeerService`
- `pages/chat/chat.component.ts` — still owns the pre-extraction 1:1 call path
- `app.routes.ts` — registers `/meet-hub` and `/meet/:roomCode`

Related but not part of this spec (found alongside, not verified against it):
`core/services/meeting-session.service.ts`, `core/services/call-session.service.ts`,
`shared/call-widget/call-widget.component.ts`. Note: styles are `.css`, not `.scss` as
might be assumed from Angular convention.

### File list (phases 3–4, Calendar + Project integration)

Backend:
- `backend/prisma/schema/meeting.prisma` — added `Meeting.calendarEventId`/`projectId` FKs
- `backend/prisma/schema/calendarEvent.prisma` — added `CalendarEvent.projectId` + `meeting` back-ref
- `backend/prisma/schema/project.prisma` — added `Project.calendarEvents[]`/`meetings[]`
- `backend/controllers/meetingController.ts` — `createMeeting` accepts `calendarEventId`/
  `projectId`, auto-creates a `CalendarEvent` when scheduled and none supplied; new
  `getProjectMeetings` handler
- `backend/controllers/eventController.ts` — `createEvent`/`updateEvent` accept `projectId`;
  `EVENT_INCLUDE` now returns `project` and a read-only `meeting` summary
- `backend/routes/projectRoutes.ts` — new `GET /:projectId/meetings` route

Frontend:
- `models/meeting.model.ts` — `calendarEventId`/`projectId`/`calendarEvent`/`project` fields
- `models/event.model.ts` — `projectId`, `project`, `meeting` fields
- `core/services/meeting.service.ts` — `create()` accepts `calendarEventId`/`projectId`
- `core/services/project.service.ts` — new `getMeetings(projectId)`
- `shared/event-detail-dialog/` — `@Input() projectId`, "Add Meet Hub room" toggle, "Join" button
- `shared/project-meetings/project-meetings.component.ts` / `.html` / `.css` — new "Meetings" panel
- `pages/project-detail/` — "Schedule Meeting" action, "Meetings" tab, embeds the event dialog

Not built (deliberately out of scope for this pass, tracked in `remaining-meethub.md` §A):
removing an auto-created `CalendarEvent` when its `Meeting` is cancelled, and
`meetingInvited`/`meetingCancelled` notifications for calendar/project-linked meetings.

### File list (phase 5, Group chat model)

Backend:
- `backend/prisma/schema/group.prisma` — new: `Group`, `GroupMember` (+ `GroupMemberRole`
  enum), `GroupMessage`, `GroupMessageRead`
- `backend/prisma/schema/user.prisma` / `organization.prisma` / `sequence.prisma` — reverse
  relations for the models above, plus a new `group` `SequenceEntity` member
- `backend/controllers/groupController.ts` — group CRUD, membership (add/remove/role
  change), leave-group (auto-promotes an admin if the last one leaves), member candidates
- `backend/controllers/groupMessageController.ts` — `getGroupMessages` (full history,
  bulk-marks read on fetch, mirrors `chatController.getMessages`)
- `backend/routes/groupRoutes.ts` — mounted at `/api/groups` in `backend/index.ts`
- `backend/middleware/validate.ts` — `validateGroup`/`validateGroupId`/
  `validateAddGroupMembers`/`validateUpdateGroupMemberRole`
- `backend/socket.ts` — `group:message:send/edit/delete/pin/seen`,
  `group:typing:start/stop`, fanned out via `emitToUser` per member (not a Socket.IO room —
  see the comment in `socket.ts` for why that differs from the meeting-room section)

Frontend:
- `models/group.model.ts` — `Group`, `GroupMember`, `GroupMessage`, `GroupWithActivity`
- `core/services/group.service.ts` — REST calls, plus a `groups` signal cache
- `core/services/socket.service.ts` — `group:*` subjects/emitters
- `shared/group-member-picker/` — new multi-select, org-scoped member picker (kept
  separate from the existing single-select `member-picker.component.ts` to avoid touching
  its project-only contract)
- `shared/create-group-dialog/`, `shared/group-members-dialog/` — new dialogs
- `pages/chat/chat.component.ts`/`.html` — new "Groups" sidebar tab, a group thread view
  sharing the DM composer/emoji-picker/image-upload/context-menu machinery, group-specific
  socket subscriptions

Not built (deliberately out of scope for this pass — no reactions/pin-UI parity, no
notifications, tracked in `remaining-meethub.md` §D):
group message reactions (schema and UI both omitted — not asked for), a "pin" button in
the group thread UI (the socket event and schema field exist, unused), and
`Notification.type` entries for group activity (added-to-group, etc.).

### File list (phase 6, Group meetings)

Backend:
- `backend/prisma/schema/meeting.prisma` — added `Meeting.groupId` (not `@unique` — a
  group can have any number of meetings over time, unlike `calendarEventId`'s
  one-room-per-event limit)
- `backend/prisma/schema/group.prisma` — added `Group.meetings Meeting[]` back-relation
- `backend/controllers/meetingController.ts` — `createMeeting` accepts `groupId`,
  validates membership via `canAccessGroup` (imported from `groupController.ts`),
  auto-invites every current group member as a `MeetingParticipant`, and forces
  `MeetingSettings.allowGuestJoin` to `false` for a group meeting (every other creation
  path keeps its existing default) so the room stays scoped to the group instead of
  becoming an org-wide open link

Frontend:
- `models/meeting.model.ts` — `groupId`/`group` fields
- `core/services/meeting.service.ts` — `create()` accepts `groupId`
- `pages/chat/chat.component.ts`/`.html` — audio/video call buttons in the group thread
  header (`startGroupCall`), which create the group `Meeting`, post a join-link
  announcement into the group chat via the existing group-messaging path, then navigate
  the initiator straight to `/meet/:roomCode` — reusing the Phase 1-2 meeting-room UI
  entirely rather than building a second in-page call surface; `renderMessageContent`
  (previously DM-only URL auto-linkify) is now reused for group messages too, so the
  join link renders as a clickable link in the thread

Not built (deliberately out of scope for this pass, tracked in `remaining-meethub.md` §E):
a persistent "call in progress" banner for members who open the group after the
announcement message has scrolled out of view (the announcement in the thread is the only
"join as they come online" mechanism); notifications for the call (same deferred
`Notification.type` extension as everywhere else in this doc).

Adaptations made during implementation (differ from the sketch below):
- New Prisma models use `Int @id @default(autoincrement())` + `sequenceId`/`SequenceEntity`,
  matching the codebase's real convention — not `String @id @default(cuid())` as drafted below.
- `Meeting` reuses the existing `CallType` enum instead of defining a new one.
- `calendarEventId`/`projectId` were added to `Meeting` once Phases 3/4 started (see the
  file list above); `groupId`/`dmWithUserId` remain deferred to Phase 6, still per the "no
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
| Group chat → call button | New: instant group meeting, all group members notified, join as they come online | ✅ Done (Phase 6) — "notified" is a join-link message posted into the group chat, not a push notification (that pipeline is still deferred) |
| Calendar Event → "Add meeting" | New: event gets a hosted Meet Hub room instead of (or alongside) a pasted link; "Join" button appears on the event when it's near start time | ✅ Done (Phase 3) |
| Project → "Schedule meeting" | New: creates a CalendarEvent (linked to the project) + a Meeting room; shows on project's activity/timeline | ✅ Done (Phase 4) — surfaced as a "Schedule Meeting" action + "Meetings" tab, not the project's activity/timeline feed (no such feed exists in this codebase) |
| Meet Hub standalone ("New meeting" like Google Meet) | New: instant ad-hoc room, shareable link/code, optional scheduling for later | ✅ Done — instant room + shareable `/meet/:roomCode` link shipped; API accepts `scheduledStart`/`scheduledEnd` but no UI exposes scheduling yet |

---

## 2. Data model changes (Prisma)

### 2.1 New: `Group` (chat groups) — required prerequisite

**Status: ✅ Done** — shipped in `backend/prisma/schema/group.prisma`, adapted like every
other new model in this doc to `Int @id @default(autoincrement())` + `sequenceId` on
`Group` (not `cuid()`); `GroupMember`/`GroupMessage`/`GroupMessageRead` are plain
autoincrement child rows with no sequenceId, matching `ProjectMember`/`Message`'s
convention. `Group.meetings Meeting[]` (for Phase 6) was **not** added yet — `Meeting` has
no `groupId` column, per the "no speculative build-out" guidance; that FK lands when
Phase 6 actually starts.

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
could ship first, independently, before meetings (see Phase plan below). ✅ **Done** —
`GroupMessage` omits `callType`/`callStatus`/`callDuration` (group calls are Phase 6) and
reactions (not asked for, easy to add later); everything else — `content`/`type`/
`fileUrl`/`isPinned`/`isEdited`/`editedAt`/`isDeleted`/`replyToId`/per-user `deletedFor` —
mirrors `Message` as drafted. `GroupMessageRead` is one row per `(message, member who's
seen it)`, standing in for `Message.read`'s single boolean (which only works for exactly
one recipient).

### 2.2 New: `Meeting` — the core entity

**Status: ✅ Done** — shipped in `backend/prisma/schema/meeting.prisma`, adapted to the
codebase's real `Int @id @default(autoincrement())` + `sequenceId` convention (not the
`cuid()` shape drafted below) and reusing the existing `CallType` enum instead of a new one.
`calendarEventId`/`projectId` were added once Phases 3/4 started; `groupId`/`dmWithUserId`
remain deferred to Phase 6.

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

**Status: ✅ Done for `CalendarEvent`/`Project` (Phase 3/4)** — `Notification` extension
still ⬜ **not started**, deferred (no meeting notifications fire yet either way).

- `CalendarEvent`: add optional back-reference `meeting Meeting?` (via the `calendarEventId` FK above) and, separately, add `projectId String?` + `project Project? @relation(...)` — **this is the missing Project↔Calendar link** noted in section 0, needed so "Project → Schedule meeting" can show on the calendar and "Calendar event → linked project" can show on the project timeline. Keep `meetingLinkUrl/Title/Platform` as-is for backwards compatibility with pasted external links (Zoom/Teams for people not ready to switch); a `CalendarEvent` can have *either* a pasted link *or* a hosted `Meeting`, or neither. ✅ Done — used `Int` FK (`projectId Int?`), matching the codebase's real id convention rather than the `String` drafted above.
- `Project`: add `calendarEvents CalendarEvent[]` and `meetings Meeting[]` relations. ✅ Done.
- `Notification`: extend the `type` enum with `meetingInvited`, `meetingStarting`, `meetingCancelled`, `meetingReminder`. ⬜ Not started.

---

## 3. Backend

### 3.1 REST — `backend/routes/meetingRoutes.ts` (new, mount at `/api/meetings`)

**Status: ✅ Done (all 9 routes)**, plus a 10th (`GET /api/projects/:projectId/meetings`,
added in Phase 4 — see `projectRoutes.ts`). `projectId`/`calendarEventId` are now accepted
on create with auto-created-`CalendarEvent` support (Phase 3/4); `groupId`/`dmWithUserId`
remain Phase 6 territory. `/upcoming` still isn't wired into a dashboard widget/banner
(§4.2 is still ⬜ for that specific item).

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/` | Create meeting (instant or scheduled). Body accepts optional `projectId`/`groupId`/`calendarEventId`/`dmWithUserId` + `scheduledStart/End`. Auto-creates a `CalendarEvent` if scheduled and none supplied. | ✅ Done for `projectId`/`calendarEventId` + calendar auto-create; `groupId`/`dmWithUserId` still Phase 6 |
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
- `meeting:leave` / disconnect → broadcast `meeting:participant-left`, update `MeetingParticipant.leftAt`, end the meeting once the room is completely empty. ✅ Done, with one deliberate change from the original sketch: ending is **not** tied to "host leaves and no co-host" — per explicit user decision, the host leaving while other members are still connected does not end the meeting (they keep talking); only the *last* participant leaving/disconnecting closes it out, reusing the same DB status-flip the "End meeting" button (§4.1) already does.
- WebRTC signaling becomes **room-relayed** instead of 1:1 direct: `meeting:signal` `{ toSocketId, sdp | candidate }` — server just relays to the target socket within the room (mesh topology, each pair negotiates directly). This is a straightforward generalization of the existing `call:offer/answer/ice-candidate` handlers — same shape, targeted at N peers instead of 1. ✅ Done, including ICE candidate relay (caught and fixed in review — the first pass shipped without it).
- `meeting:mute`, `meeting:video-toggle`, `meeting:screen-share`, `meeting:hand-raise`, `meeting:chat-message` (in-room ephemeral chat, separate from persisted Group/DM chat), `meeting:kick` (host only, re-verified server-side against `Meeting.hostId`), `meeting:end` (host only; relays after the REST `POST /:id/end` already flipped status, so it's purely the real-time "leave now" fan-out) ✅ Done.
- Reuse existing `notification:new` pipeline for `meeting:invited`/`meeting:starting` (fire 5 min before `scheduledStart` via the existing BullMQ/ioredis job queue — already a dependency, currently unused for this but a natural fit for scheduled reminders, similar to how `EventReminder` presumably should trigger today). ⬜ Not done.

**Mesh vs SFU decision point:** native mesh WebRTC (what's already built for 1:1) scales
poorly past ~4-5 participants (each client uploads N-1 streams). Recommend:
- **Phase 1**: cap group meetings at 4 participants, ship with mesh (zero new infra, reuses 100% of existing WebRTC client code path). ✅ Done — `MEETING_ROOM_CAPACITY = 4` enforced server-side in `meeting:join`.
- **Phase 2** (if usage demands larger meetings): introduce an SFU. Cheapest paths given zero existing video infra: self-hosted **mediasoup** (more backend work, full control, no per-minute cost) or a hosted SDK (**LiveKit Cloud** or **Daily.co** — fastest to integrate, per-minute billing). This is a build-vs-buy call to make with the user once Phase 1 ships and real usage/participant-count data exists — don't pre-build it speculatively. ⬜ Not started — correctly deferred, no usage data yet.

### 3.3 Recording (decided: not needed)

**Status: decided against, per explicit user call** — `MeetingSettings.recordingEnabled`
stays in the schema (harmless, unused) but nothing will be built against it. Previously an
open question (§6); resolved.

---

## 4. Frontend (Angular)

### 4.1 New feature module: `frontend/src/app/pages/meet-hub/`

- `meet-hub.component.ts` — landing view: "New meeting" (instant), "Join with code", "Upcoming meetings" list (calls `GET /api/meetings/upcoming`). ✅ Done.
- `meeting-room/meeting-room.component.ts` — the actual in-call UI: video tile grid, mute/camera/screen-share/leave controls, participant list, in-room chat panel, raise-hand. **Extract the WebRTC peer logic currently inline in `chat.component.ts` (lines ~778-965) into a shared `WebrtcPeerService`** so both the 1:1 chat call and the new N-way meeting room use the same peer-connection/media-stream primitives instead of duplicating them. This refactor is worth doing regardless of meetings, and de-risks the group-call work. — ✅ **Done**: video tile grid, mute/camera/leave controls, and the `WebrtcPeerService` extraction (actual pre-refactor line range was ~770-959, not 778-965) are all shipped. Also now done: screen-share (reuses the reserved-video-sender `replaceTrack` approach already built for 1:1 calls — `MeetingSessionService.connectToPeer` now passes `reserveVideoSlot: true`), raise-hand (with a tile badge), an in-room ephemeral chat panel, host-only "remove participant" per tile, and an "End meeting" button. ⬜ **Not done**: a dedicated participant-list panel — tiles still double as the list.
- `meeting-lobby/meeting-lobby.component.ts` — pre-join screen (camera/mic preview + device picker + "Ask to join" if waiting room enabled), matches the Google Meet mental model the user referenced. — ✅ **Done**: camera/mic preview + mute/camera toggle before joining, plus a device picker (`enumerateDevices()`, re-acquires the local stream against the chosen camera/mic before join — no mid-call renegotiation needed since no peers exist yet at that point). ⬜ **Not done**: the "Ask to join" waiting-room flow (`MeetingSettings.waitingRoomEnabled` exists but is inert) — a bigger, separate approval-flow feature.
- Service: `core/services/meeting.service.ts` (REST calls) + extend `socket.service.ts` with the new `meeting:*` event subjects, following the existing `callIncoming$`/`callOffer$` pattern. ✅ Done.
- Route: `/meet/:roomCode` (shareable/joinable link, guarded — prompts login if not authenticated, then drops into lobby). ✅ Done, guarded by `authGuard` (redirects to login if unauthenticated, same as every other authenticated route — no separate guest-join flow was built).

### 4.2 Integration touch points (reusing existing UI, not new pages)

**Status: ⬜ Not started (all of §4.2)** — Meet Hub currently only exists as its own
standalone area; none of the existing pages below have been touched to surface it.

- **Chat** (`pages/chat/chat.component.ts`): existing call button stays for 1:1 (no behavior change to the user); internally it now creates a `Meeting` row via the service instead of only socket signaling, so call history and meeting history are unified in the `Meeting`/`MeetingParticipant` tables going forward (existing `Message`-based call log can remain read-only/legacy for old records). ⬜ Not done — the chat call button still only does 1:1 socket signaling, no `Meeting` row.
- **Group chat**: same call button, creates a group `Meeting`. ⬜ Not started (Phase 6) — Group chat itself now exists (§2.1/§File list phase 5), but no call button/`Meeting.groupId` wiring yet.
- **Calendar** (`shared/event-detail-dialog/`, the actual event create/edit dialog — not `shared/calendar-form/`, which only edits the `Calendar` container): "Add Meet Hub room" toggle (creates a `Meeting` via `calendarEventId` + fills `meetingLinkUrl` with the internal `/meet/:roomCode` link) as an alternative to pasting an external link. A "Join" button appears in the dialog header once the meeting is ~5 min from `start`. ✅ Done (Phase 3).
- **Projects** (`pages/project-detail/`): "Schedule Meeting" action added to the existing Actions dropdown, opens `event-detail-dialog` pre-scoped via `[projectId]` (forces the Meet Hub toggle on); a new "Meetings" tab renders `<app-project-meetings>`, an "Upcoming/past meetings" panel mirroring `project-teams`' structure. ✅ Done (Phase 4).
- **Notifications** (`shared/notification-bell/`, `notifications-feed.service.ts`): render new `meetingInvited`/`meetingStarting` types with a "Join" quick action. ⬜ Not started (depends on §2.3's `Notification.type` extension).
- **Dashboard** (`pages/dashboard`): optional "Join now" banner if a meeting the user is invited to is starting within N minutes — same pattern likely already used for task due-date nudges, check `dashboard.component.ts` for an existing banner pattern to match. ⬜ Not started — and confirmed there's no existing due-date "banner"/"nudge" pattern in `dashboard.component.ts` to mirror (only a static welcome banner and an "Overdue" stat tile), so this would be new UI, not a port of an existing pattern.

---

## 5. Suggested build phases

1. ✅ **Done** — **Refactor WebRTC into `WebrtcPeerService`** (no behavior change) — de-risks everything after it. Small, isolated, testable against existing 1:1 call.
2. ✅ **Done** — **`Meeting` model + REST + instant ad-hoc meetings** (no groups/calendar/project yet) — ships the "New meeting, share link, join" Google-Meet-style flow standalone, reusing 1:1-capable mesh WebRTC. Validates room/token/socket-namespace design end-to-end with the smallest scope.
3. ✅ **Done** — **Calendar integration** — `meetingLinkUrl` alternative, "Join" button on events, `Project↔CalendarEvent` relation.
4. ✅ **Done** — **Project integration** — "Schedule meeting" action, project meetings panel.
5. ✅ **Done** — **Group chat model** (`Group`/`GroupMember`/`GroupMessage`/`GroupMessageRead`) — full REST + Socket.IO messaging and a "Groups" tab in the chat page. Reactions and group notifications were left out (see the phase-5 file list's "not built" note).
6. ✅ **Done** — **Group meetings** — wired the group call button using the same `Meeting`/`WebrtcPeerService` from phase 1-2, capped at ~4 mesh participants (unchanged, enforced server-side regardless of caller).
7. ⬜ **Not started** — **Scale decision**: revisit SFU (mediasoup vs LiveKit/Daily) only if usage data from phases 2-6 shows demand for >4-person meetings.

Phases 1-4 deliver the "meetings connected to calendar and projects" ask without requiring
group chat at all — **done**. Phases 5-6 together deliver the full "group chat calls"
ask — **done**. Only Phase 7 (the SFU scale decision) remains, and it's intentionally
gated on real usage data that doesn't exist yet.

---

## 6. Open questions for the user

- ~~Is group chat (Phase 5) already planned/tracked elsewhere...~~ — resolved: built as
  part of Meet Hub (see §2.1 / phase-5 file list above).
- Participant cap comfort for Phase 1-2 mesh calls (recommend 4) vs. willingness to take on SFU infra/cost sooner for larger meetings?
- ~~Recording — needed for v1, or defer?~~ — resolved: not needed (see §3.3).
- External calendar sync (Google Calendar/Outlook) — in scope, or is the existing in-app `Calendar`/`CalendarEvent` the only surface for now?
