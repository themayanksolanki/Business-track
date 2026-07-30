# Meet Hub — Remaining Work

Punch-list of everything **not yet done**, extracted from `meet-hub.md` (as of 2026-07-30).
Phases 1–6 (WebRTC extraction, `Meeting` model + REST + Socket.IO + standalone UI,
Calendar/Project integration, the Group chat model, and Group meetings) are shipped — see
that file for the verified file lists. Everything below is outstanding.

---

## A. Loose ends inside shipped Phases 1–2

- **Unify 1:1 chat calls onto `Meeting`** — chat call button (`pages/chat/chat.component.ts`)
  still only does 1:1 socket signaling; it doesn't create a `Meeting` row, so call history
  stays on the legacy `Message`(`type: 'call'`) log instead of `Meeting`/`MeetingParticipant`.
- **Scheduling UI** — ✅ done: a "Schedule for later" toggle on the Meet Hub landing page
  (title + date/start-time/end-time pickers, reusing the existing `app-date-picker`/
  `app-time-picker` components) calls `POST /api/meetings` with `scheduledStart`/`scheduledEnd`.
- **`GET /upcoming` surfaced** — ✅ done: a dashboard widget lists upcoming meetings, plus a
  prominent "Join now" banner when one is within 5 minutes of `scheduledStart` (same rule
  as the event dialog's Join button).
- **Socket events** — ✅ done: `meeting:screen-share`, `meeting:hand-raise`,
  `meeting:chat-message` (in-room ephemeral, unpersisted), `meeting:kick` (host-only,
  re-verified server-side against `Meeting.hostId`), and `meeting:end` (host-only; the
  REST `POST /:id/end` still does the durable status flip, this is purely the real-time
  "everyone leave now" fan-out to the room).
- **Auto-ending a meeting** — ✅ done, per explicit user decision: only when the room
  becomes completely empty (last participant leaves/disconnects) — **not** tied to the host
  specifically. The host leaving while other members are still on the call does not end
  it; they keep talking. Runs synchronously inside the existing `leaveMeetingRoom` handler
  (shared by both `meeting:leave` and `disconnect`), reusing the same DB status-flip the
  explicit "End meeting" button already does.
- **Reminder pipeline (`meetingReminder`)** — ✅ *partially done*: `meetingStarting`/
  `meetingCancelled`/`groupMemberAdded` notifications now exist and fire (see below), but
  the ~5-min-before-`scheduledStart` **reminder** specifically still needs the BullMQ/
  ioredis delayed-job queue wired up — that's a distinct scheduling mechanism, not just
  another notification call, and remains unbuilt. `meetingInvited` is also still unfired:
  there's no flow anywhere that explicitly invites specific people to a *scheduled* (not
  instant) meeting yet, so the type would have no real trigger.
- ~~Recording~~ — **decided: not needed**, per explicit user call. `MeetingSettings.recordingEnabled`
  stays in the schema (unused, harmless) but nothing builds against it going forward;
  removed from the open-questions list in `meet-hub.md` §6.
- **Meeting room UI** — ✅ done: screen-share (reuses the reserved-video-sender
  `replaceTrack` machinery already built for 1:1 calls, generalized to N peers), raise-hand
  (with a tile badge), an in-room chat panel (ephemeral, side panel), and a host-only
  "remove participant" button per remote tile. **Still not done**: a dedicated
  participant-list panel — tiles still double as the list, which was explicitly left as-is
  since nothing about the new controls required it.
- **Meeting lobby** — ✅ done: a camera/mic device picker (`enumerateDevices()`, re-acquires
  the local stream against the chosen device pre-join). **Still not done**: the "Ask to
  join" waiting-room flow (`MeetingSettings.waitingRoomEnabled` exists but is inert) —
  that's a bigger, separate approval-flow feature, not bundled into this pass.
- **No UI button for `POST /:id/end`** — ✅ done: an "End meeting" button (host-only,
  gated on `Meeting.hostId`) now calls it, paired with the new `meeting:end` socket relay
  above so every other participant's client leaves in real time too.
- **Cancel-meeting invitee notifications** — ✅ done: `cancelMeeting` now fires
  `meetingCancelled` to every participant except the canceller, for any meeting
  (standalone/calendar/project/group-linked alike).
- **Cancelling a meeting now cleans up its auto-created `CalendarEvent`** — ✅ done: added
  `Meeting.calendarEventAutoCreated` (true only when `createMeeting` itself created the
  bare event, false when an existing event was supplied) so `cancelMeeting` can safely
  delete just the bare auto-created event and leave a real pre-existing one untouched.
- **`meetingCancelled` for calendar/project-linked meetings** — ✅ done (same
  `cancelMeeting` fix above covers every meeting, not just group ones).
  `meetingInvited` remains unfired — still no explicit-invite flow (see above).

## B. Phase 3 — Calendar integration — ✅ done, see `meet-hub.md` §"File list (phases 3–4)"

## C. Phase 4 — Project integration — ✅ done, see `meet-hub.md` §"File list (phases 3–4)"

## D. Phase 5 — Group chat model — ✅ done, see `meet-hub.md` §"File list (phase 5)"

Loose ends left inside this shipped phase (deliberately out of scope for the initial pass):

- **No reactions on group messages** — `MessageReaction`'s per-emoji, per-user toggle
  wasn't mirrored onto `GroupMessage` (not asked for; the schema has room to add a
  `GroupMessageReaction` table later without breaking anything).
- ~~No "pin" button in the group thread UI~~ — correction: this was already built in
  Phase 5 (`openGroupMessageMenu`'s context menu includes Pin/Unpin, same as the DM
  thread's three-dot menu) — this list previously described it inaccurately as missing.
- **No group-activity notifications** — ✅ *partially done*: being added to a group
  (at creation or via `addGroupMembers`) now fires `groupMemberAdded`. An `@mention`
  inside a group message still doesn't notify anyone — that's a separate, unbuilt
  trigger (group messages have no `@mention` parsing at all yet, unlike task comments).
- **Group avatar upload** — ✅ done: a new `groupAvatarUpload` Cloudinary middleware +
  `uploadGroupAvatar` handler (mirrors `authController.updateAvatar`'s destroy-old-then-save
  pattern) plus a clickable avatar in `group-members-dialog`'s header; the group's photo now
  also renders in the chat sidebar list and thread header (previously always the initial).
- **Read receipts are "seen by everyone" only** — the group thread shows a single
  blue-double-check once every member has read a message, not a per-member "seen by
  Alice, Bob" breakdown (WhatsApp-style). `GroupMessageRead` already stores enough data
  to build that later; only the UI is simplified for now.

## E. Phase 6 — Group meetings — ✅ done, see `meet-hub.md` §"File list (phase 6)"

Loose ends left inside this shipped phase (deliberately out of scope for the initial pass):

- **No persistent "call in progress" banner** — the only way a member learns a group
  call is happening is the join-link message posted into the thread at call-start time.
  If it scrolls out of view (or they weren't online yet), there's no ongoing indicator —
  they'd need to scroll back to find the link. A `GET`-able "is there a live meeting for
  this group right now" check (or embedding it in `getGroupById`) would fix this later.
- **Notifications** — ✅ done: starting a group call now fires `meetingStarting` to
  every other group member, with a "Join" click-through (`notifications-feed.service.ts`'s
  `linkFor()` routes straight to `/meet/:roomCode`).
- **No past-group-meetings history/panel** — unlike Project's "Meetings" tab (Phase 4),
  there's no equivalent list of a group's past calls; the join-link chat messages are the
  only record. Not asked for in the Phase 6 spec, but a natural follow-up if wanted.

## F. Phase 7 — Scale decision: SFU (not started, no usage data yet)

- Revisit only once real usage/participant-count data from Phases 2–6 (group meetings now
  actually exist and are usable end-to-end, so this data can finally start accumulating)
  shows demand for >4-person meetings.
- Build-vs-buy options already scoped: self-hosted **mediasoup** (more backend work, full
  control, no per-minute cost) vs. hosted **LiveKit Cloud** / **Daily.co** (fastest
  integration, per-minute billing). Make this call with the user when the time comes —
  don't pre-build.

## G. Open questions still unresolved (§6 of `meet-hub.md`)

- Participant cap for Phase 1-2/6 mesh calls: keep at 4, or take on SFU infra/cost sooner?
- External calendar sync (Google Calendar/Outlook): in scope, or is in-app
  `Calendar`/`CalendarEvent` the only surface for now?

(Group chat's in-scope-vs-deferred question was already resolved — see §D above. Recording
was resolved too — see §A: decided not needed.)

## H. Verification/hardening pass (2026-07-30)

A 4-way adversarial code review of everything built across this session's polish work
turned up a handful of real bugs, all now fixed and re-verified (`tsc --noEmit` + `ng build`
both clean):

- **Cross-org security hole**: `canEditMeeting`/`canEndMeeting` didn't check
  `meeting.organizationId` against the caller's org (every sibling access-check function
  does) — an Admin in one org, or a numerically-colliding host id, could edit/end another
  org's meeting. Fixed to mirror `canAccessMeeting`'s pattern.
- **Kick had no durable effect**: a kicked user could immediately rejoin via REST + a fresh
  socket join. Added a session-scoped `kickedFromMeeting` map, written in `meeting:kick`,
  enforced in `meeting:join`.
- **`meeting:end` socket relay was host-only**, narrower than the REST endpoint's
  host/co-host/Admin rule — a legitimate co-host/Admin end via REST would silently fail to
  broadcast `meeting:ended`, leaving everyone else stuck in a "live" UI. Widened to match.
- **Auto-end TOCTOU race**: the room-emptiness check and the DB write are two separate
  ticks; a same-user reconnect (tab refresh/network blip) landing in that gap could get
  silently overwritten by a stale "ended" status. Mitigated with a 3s grace period that
  re-checks before committing.
- **`group:typing:start`/`stop` skipped the membership check** every other `group:*`
  handler does — a non-member could inject typing noise into / probe membership of groups
  they don't belong to. Fixed.
- **`cancelMeeting` notified before its delete transaction committed** — a failed
  transaction would leave users told a meeting was cancelled while it's still live in the
  DB. Reordered to notify only after commit. Also added a "still bare" (no
  description/guests/attachments) safety check before deleting an auto-created calendar
  event, so a since-enriched event survives cancellation.
- **`addGroupMembers` didn't filter the actor's own id** the way `createGroup` does — fixed
  for consistency.
- **Minimized call-widget never heard `kicked$`/`ended$`** — only `meeting-room.component`
  subscribed, so a user viewing the floating mini-widget got no notice when kicked or when
  the meeting ended. Added the same subscriptions to `call-widget.component.ts`, guarded so
  it doesn't double-fire alongside the full room page.
- **`chat.component.ts`'s `onGroupDeleted`/`onLeftGroup`** didn't clear
  `replyingTo`/`editingMessage`/`messageText`, leaving an orphaned reply/edit banner if a
  group was deleted/left mid-compose. Fixed.
- **Meeting-lobby device-switch race**: clicking Join while a camera/mic switch
  (`applyDeviceSelection`) was still in flight could join with no local media tracks at all
  (the stream is briefly null between the old one stopping and the new one resolving).
  Added a `switchingDevice` guard that disables Join until the switch settles.

Left as documented trade-offs (rare/self-correcting, not fixed): `resolvePendingGroupDeepLink()`'s
race with manual navigation, `groupCallStarting`'s cross-group flag leak, the mini-widget's
`label === 'You'` mirror check (works correctly today, just not the most robust identity
check), and `kicked$`/`ended$` firing on an already-no-op `leave()`.
