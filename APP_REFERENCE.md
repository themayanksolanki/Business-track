# App Reference — Quick Orientation

Personal reference notes for this codebase: what it is, where things live, and how the
main flows work. Written 2026-08-03 by reading the actual code (not just the docs below).

**Note:** `README.md` at the repo root is stale — it describes an early "TaskFlow" MEAN
prototype (JS backend, plain Task model, 3 roles). The real app has grown far beyond
that into a multi-tenant project/task/metrics/meeting platform. Don't trust `README.md`
for anything beyond "this project started as a task tracker."

---

## 1. What this app is

A multi-tenant (organization-scoped) work platform: projects with a task/subtask tree,
KPI/metric tracking, a calendar, 1:1 + group chat, and in-app video meetings (own "Meet
Hub", not a third-party SDK). Everyone in the app belongs to an `Organization`; almost
every query is scoped by `organizationId`.

**Stack**
| Layer | Tech |
|---|---|
| Backend | Node + Express, **TypeScript**, ESM (`tsx watch` in dev) |
| Main DB | **Postgres via Prisma 7** (driver adapters, `@prisma/adapter-pg`) |
| Secondary DB | **MongoDB via Mongoose** — used only by the Metric Tracking feature |
| Realtime | **Socket.IO** (chat, presence, calls, meetings, groups) |
| Auth | JWT (access + refresh, refresh likely cookie-based) |
| File storage | **S3** (large attachments, presigned URLs) + **Cloudinary** (small images: avatars, chat images) |
| Jobs | **BullMQ + ioredis** (one real queue: user deactivation); attachment cleanup is a plain `setInterval`, not a queue |
| Frontend | **Angular 18**, all standalone components, no NgModules except `angular-calendar`'s `forRoot()` (isolated to the calendar route) |
| Frontend UI | Bootstrap 5 + ng-bootstrap, ECharts (gauge/tree/trend charts), CKEditor 5, angular-calendar, socket.io-client, dayjs + date-fns, lodash-es |

Root-level markdown docs worth knowing about (feature specs / audits, not always 100%
in sync with code — treat as history, verify against code before relying on specifics):
- `meet-hub.md` — Meet Hub build spec + phase-by-phase implementation status
- `remaining-meethub.md` — outstanding Meet Hub punch-list
- `meeting-feature-ux.md` — user-facing walkthrough of the meeting feature
- `call-bugs.md` — known bugs/security gaps in 1:1 calling (unfixed as of writing)
- `mcu-to-sfu.md` — decision doc: stay mesh WebRTC, defer SFU until usage data exists
- `calendar.md` — calendar feature spec + known gaps
- `TASK_APPROVAL_PROGRESS.md` — Task Approval feature implementation log
- `metric.md` — Metrics/KPI feature spec (config + daily "bowling view" tracking)
- `TODO-attachment-direct-url-refactor.md` — planned fix for blob-fetch attachments being silently blocked by ad-blockers

---

## 2. Backend (`backend/`)

```
backend/
├── controllers/    25 files — request handlers
├── routes/         18 files — Express routers, mounted in index.ts
├── middleware/      6 files — auth, roles, validation, uploads, error handling
├── prisma/
│   ├── schema/     20 .prisma files, one per feature domain
│   └── migrations/ 35 timestamped folders (latest: 2026-08-01)
├── models/          metricTracking.model.ts — the ONLY Mongoose model
├── services/        orgScoped, projectAccess, task, statusSync, attachment,
│                     meetingLinkCalendarSync — cross-cutting business logic
├── utils/           14 files — AppError, sequence IDs, mentions, notifications,
│                     recurrence expansion, meeting token/link/room-code, mailer, etc.
├── lib/              prisma.ts, redis.ts, s3.ts — shared client singletons
├── jobs/             attachmentSweeper.ts (setInterval, not a queue)
├── queues/ + workers/ userDeactivationQueue.ts / userDeactivationWorker.ts (BullMQ)
├── scripts/          one-off migration/backfill scripts
├── types/            express.d.ts (Request augmentation)
├── socket.ts         Socket.IO setup + all realtime handlers
├── index.ts          app entrypoint (no separate app.ts)
└── prisma.config.ts  Prisma 7 config
```

### Prisma schema files → models

| File | Models |
|---|---|
| `user.prisma` | User |
| `organization.prisma` | Organization, Invite |
| `department.prisma` | Department |
| `category.prisma` | Category |
| `tag.prisma` | Tag |
| `project.prisma` | Project, ProjectMember |
| `projectItem.prisma` | ProjectItem (group/task/subtask tree), Comment |
| `projectRole.prisma` | ProjectRole |
| `task.prisma` | Task (legacy standalone Todo, separate from ProjectItem) |
| `taskApproval.prisma` | TaskApprover, ApprovalHistory, ApprovalComment |
| `attachment.prisma` | Attachment (shared: project/task/event/comment) |
| `calendarEvent.prisma` | Calendar, RecurringRule, Guest, EventReminder, CalendarEvent, EventException |
| `meeting.prisma` | Meeting, MeetingParticipant, MeetingSettings |
| `message.prisma` | Message, MessageReaction (1:1 chat + call log) |
| `group.prisma` | Group, GroupMember, GroupMessage, GroupMessageRead |
| `metric.prisma` | Metric, MetricPeriodTotal (Postgres side of KPI feature) |
| `notification.prisma` | Notification |
| `statusForm.prisma` | StatusForm, StatusFormQuestion |
| `sequence.prisma` | OrgSequence (per-org human-readable sequence IDs) |
| `main.prisma` | no models — generator/datasource config only |

Mongoose (`backend/models/metricTracking.model.ts`): `MetricTracking` — per
`(metricId, frequency, year, month)` document holding a `periods` map of day→
`{actual, target}` + denormalized totals. Only `frequency: 'daily'` is actually
implemented; weekly/monthly/quarterly/yearly are modeled but throw "not implemented."

### Controllers / Routes (grouped by domain)

| Domain | Controller(s) | Route file |
|---|---|---|
| Auth | authController | authRoutes (`/api/auth`) |
| Users | userController | userRoutes (`/api/users`) |
| Org/taxonomy | organizationController, departmentController, categoryController, tagController | organizationRoutes, departmentRoutes, categoryRoutes, tagRoutes |
| Projects | projectController, projectItemController, projectMemberController, projectCommentController, taskApprovalController | projectRoutes (`/api/projects`) — also pulls in meeting + attachment controllers |
| Project roles | projectRoleController | projectRoleRoutes |
| Tasks (legacy) | taskController | taskRoutes (`/api/tasks`) |
| Attachments | attachmentController | no standalone route file — mounted inline inside project/task/event/metric routes |
| Chat (1:1) | chatController | chatRoutes (`/api/chat`) |
| Groups (chat) | groupController, groupMessageController | groupRoutes (`/api/groups`) |
| Calendar | calendarController, eventController | calendarRoutes, eventRoutes |
| Meetings | meetingController | meetingRoutes (`/api/meetings`) |
| Metrics | metricController (Postgres config), metricTrackingController (Mongo period data) | metricRoutes (`/api/metrics`) |
| Notifications | notificationController | notificationRoutes |
| Status forms | statusFormController | statusFormRoutes |
| Dashboard | dashboardController | dashboardRoutes |

### `backend/index.ts` — mounts & middleware order

1. `setupSocket(server)` (Socket.IO wraps the same HTTP server)
2. `express.urlencoded()` (10mb) → `helmet()` → `cors()` (allow-list from `CLIENT_URL`)
3. `GET /health` (liveness, no DB) and `GET /health/db` (real `SELECT 1` — frontend
   pings this on the login page to wake a sleeping free-tier Postgres instance)
4. `express.json()` (10mb) → `cookie-parser()`
5. `/uploads` static serving (local-disk fallback; prod uses S3/Cloudinary)
6. Route mounts: `/api/auth`, `/api/users`, `/api/tasks`, `/api/chat`, `/api/projects`,
   `/api/departments`, `/api/organizations`, `/api/tags`, `/api/categories`,
   `/api/project-roles`, `/api/notifications`, `/api/dashboard`, `/api/metrics`,
   `/api/events`, `/api/calendars`, `/api/meetings`, `/api/groups`, `/api/status-forms`
7. `errorMiddleware` last

Startup: connect Prisma (fatal if fails) → connect Mongoose (non-fatal) → start
attachment sweeper → `server.listen()`. Also imports the BullMQ worker for its
side effect. Note: `globalLimiter` (rate limiting) is imported but **commented out**;
`authLimiter` exists but isn't actually wired to any route.

### `backend/socket.ts` — realtime event namespaces

JWT-authenticated at handshake (`socket.handshake.auth.token`). In-memory presence
(`onlineUsers: Map<userId, Set<socketId>>`), broadcasts `users:online`.

- **`message:*`** — 1:1 DM chat (send/edit/delete/pin/react/seen)
- **`typing:*`** — 1:1 typing indicator
- **`call:*`** — 1:1 WebRTC signaling (request/accepted/rejected/ended/offer/answer/
  ice-candidate/mute/video/screen-share); logs a `Message(type:'call')` row on end
- **`meeting:*`** — N-way mesh WebRTC meeting rooms, native Socket.IO rooms, capped
  at **4 participants** (`MEETING_ROOM_CAPACITY`, `socket.ts:11`): join/leave/signal/
  mute/video-toggle/screen-share/hand-raise/chat-message(ephemeral)/kick(host-only)/
  end(host+co-host+Admin). Auto-ends the meeting after a 3s grace period once the room
  is fully empty (not tied to the host leaving specifically).
- **`group:message:*` / `group:typing:*`** — persistent group chat, fanned out per
  member via `emitToUser` (deliberately **not** a Socket.IO room, unlike meetings)
- `disconnect` — cleans up presence, active calls, meeting-room membership

`emitToUser(userId, event, data)` is the shared helper other backend code (e.g.
notifications) uses to push to every socket a user currently has open.

### Other subsystems

- **Validation**: one big hand-rolled `middleware/validate.ts` (~980 lines, no
  zod/joi), one function per resource/action, calls `next(new AppError(msg, 400))`.
- **Errors**: `utils/AppError.ts` + `middleware/errorMiddleware.ts` (catch-all,
  normalizes Multer/Cloudinary/AWS SDK/JWT errors into a common shape).
- **Auth**: `middleware/authMiddleware.ts` (`protect`) verifies JWT, loads Prisma
  `User`, strips password, sets `req.user`. `middleware/roleMiddleware.ts`
  (`allowRoles(...)`) does simple string-based role gating (`Admin`/`Manager`/
  `Team Lead`/`User`).
- **Files**: S3 (`lib/s3.ts`, custom multer engine streaming to S3, presigned URLs,
  100MB cap) for attachments; Cloudinary (`middleware/upload.ts`) for small images
  (avatars 2MB, chat images 5MB, group avatars 2MB) — comments say this split exists
  because Cloudinary's free tier caps at 10MB.
- **Jobs**: BullMQ `user-deactivation` queue/worker reassigns a deactivated user's
  tasks/items/projects to a handler and notifies the actor. Attachment cleanup is a
  plain 2s `setInterval` (`jobs/attachmentSweeper.ts`), by design (short pending-delete
  window, not worth a queue).
- Notable utils: `sequence.ts` (org-scoped human IDs), `mentions.ts` (@mention
  parsing), `notifications.ts` (`notifyUser` — persists + pushes live), `recurrence.ts`
  (calendar RRULE-style expansion), `meetingToken.ts`/`meetingLink.ts`/`roomCode.ts`,
  `metricPeriods.ts` (bridges Postgres `Metric.frequency` ↔ Mongo period math),
  `mailer.ts` (nodemailer/Gmail, respects `SKIP_EMAIL` env flag).

---

## 3. Frontend (`frontend/src/app/`)

```
app/
├── app.component.ts        — root shell: sidebar + <router-outlet> + global loader + toasts
├── app.config.ts            — router, HttpClient+interceptors, APP_INITIALIZER (session restore)
├── app.routes.ts             — top-level route table
├── core/
│   ├── guards/               authGuard, guestGuard, roleGuard
│   ├── interceptors/         tokenInterceptor, loadingInterceptor
│   └── services/             33 injectable services — the entire data/state layer
├── models/                   23 files, plain TS interfaces mirroring backend DTOs
├── pages/                    23 routed feature folders
└── shared/                   ~65 reusable components/dialogs/pipes/directives
```
No NgModules anywhere except `angular-calendar`'s `CalendarModule.forRoot()`, isolated
to `calendar.routes.ts` via a route-level environment injector so it (+ date-fns)
stays out of the main bundle.

### Pages (`pages/`)

| Page | Purpose |
|---|---|
| login / register / forgot-password / accept-invite | auth flows (guestGuard) |
| pricing | public marketing page, no guard |
| dashboard | home after login — task/project/dept/team stat aggregates |
| task-list | main "Todos" list (`/tasks`) |
| edit-task | full-page task editor (`/tasks/:id/edit`) |
| task-form | **exists on disk, not wired into any route** — likely dead/superseded by `edit-task` + `shared/task-form-modal` |
| projects | Projects list (list/table/card view modes) |
| project-detail | single project workspace — kanban/tree/table of items, comments, attachments, teams, meetings; also reachable via shareable `/projects/shared/:organizationId/:sequenceId` |
| drafts / draft-detail | pre-published project drafts list + detail |
| calendar | shell + lazy `day-view`/`week-view`/`month-view` children |
| meet-hub | video meeting hub: shell + `meeting-lobby`, `meeting-room`, `video-tile` |
| chat | 1:1 + group messaging |
| metrics | main KPI metrics list |
| metric-bowling | daily bowling-view grid (`/metrics/bowling`) |
| metric-tiles | gauge/tile KPI dashboard (`/metrics/tiles`) |
| user-list | Admin/Manager user management |
| organization | org-wide settings (Admin/Manager) |
| settings | tabbed admin settings: categories/departments/general/project-roles/status-forms/tags |
| profile | logged-in user's own profile/preferences |

### Shared components (highlights, `shared/`)

Dialog/modal family: `attachment-viewer`, `attachment-panel`, `confirm-dialog`,
`event-detail-dialog` (calendar), `task-detail-modal`/`task-edit-modal`/
`task-form-modal`, `task-attachments-modal`, `task-approval-modal`,
`create-group-dialog`, `group-members-dialog`, `move-to-project-dialog`,
`move-to-group-dialog`, `task-picker-dialog`, `add-member-modal`.

Form family: `project-form`, `category-form`, `department-form`, `tag-form`,
`project-role-form`, `calendar-form`, `metric-form-modal`, `status-form-builder`.

Charts: `gauge-chart`, `tree-chart`, `trend-chart` (all ECharts).

Chat/call: `call-widget` (floating in-call widget, app-wide), `call-icon`,
`emoji-picker`, `group-member-picker`.

Project tree/board: `project-tree-node` (recursive renderer), `kanban-board`,
`project-teams`, `project-meetings`, `linked-tasks`, `project-item-detail`,
`project-status`, `project-attachments-card`, `project-plan-card`,
`project-list-overlay` (flyout from sidebar).

Misc: `sidebar` (main nav, see below), `notification-bell`, `toast-container` +
`notification.service`, `global-loader` + `loading.service`, `data-table`,
`icon` (central SVG icon component), `tag-picker`/`tag-pill`, `member-picker`,
`mini-month-picker`, `day-events-dialog`, `date-picker`/`time-picker`,
`context-menu`, `tab-strip`, `help-tip`, `frequency-icon`, `metric-tracking-grid`
(currently a **custom-built** grid; `handsontable`/`@handsontable/angular-wrapper`/
`hyperformula` were added to `frontend/package.json` on 2026-08-03 per `metric.md`'s
spec, but not yet wired into this component — still TODO to migrate).

### Core services (`core/services/`, one-liners)

`auth` (session/login/refresh), `user`, `task`, `project`, `projects-view` (list/
table/card mode memory), `project-role`, `category`, `department`, `tag`,
`organization`, `dashboard`, `calendar` (Calendar entities), `event` (CalendarEvent
CRUD/recurrence/RSVP), `calendar-state` (shared UI state for day/week/month),
`attachment`, `chat` (1:1 DMs), `group` (group chat), `socket` (Socket.IO wrapper —
underpins chat/notifications/presence/meetings), `call-session` (1:1 call state),
`meeting` (Meet Hub CRUD/scheduling), `meeting-session` (active meeting state),
`webrtc-peer` (shared WebRTC peer logic — extracted so 1:1 calls and N-way meetings
reuse the same primitives), `metric`, `notifications-feed`, `status-form`,
`sidebar` / `sidebar-appearance` (layout + theme/branding preview), `theme`
(light/dark), `date-format`, `loading`.

### Guards & interceptors

- `authGuard` — requires session (fast in-memory check, else silent refresh attempt)
- `guestGuard` — blocks logged-in users from auth pages
- `roleGuard` — checks `route.data['roles']` (used on `/users`, `/organization`)
- `tokenInterceptor` — attaches Bearer token (skips `/uploads/` and external URLs),
  auto-refreshes on 401 and retries once, clears session on 403
- `loadingInterceptor` — opt-in via `SHOW_LOADER` HttpContextToken (not every request)

### Route tree (`app.routes.ts`)

```
/                         → redirect /dashboard
/login, /register,
/forgot-password,
/accept-invite/:token     [guestGuard]
/pricing                  (no guard)

/dashboard                [authGuard]
/tasks                    [authGuard]
/tasks/:id/edit           [authGuard]
/users                    [authGuard, roleGuard: Admin|Manager]
/organization             [authGuard, roleGuard: Admin|Manager]
/chat                     [authGuard]
/projects                 [authGuard]
/projects/:id             [authGuard]
/projects/shared/:organizationId/:sequenceId  [authGuard]
/drafts, /drafts/:id      [authGuard]
/profile                  [authGuard]
/metrics                  [authGuard]
/metrics/bowling          [authGuard]
/metrics/tiles            [authGuard]
/calendar/**              [authGuard]  → lazy calendar.routes.ts → day|week|month (default month)
/settings                 [authGuard]  (tabs handled inside the component, not in routes)
/meet-hub/**              [authGuard]  → lazy meet-hub.routes.ts
/meet/:roomCode           [authGuard]  (shareable meeting deep link)
**                        → redirect /dashboard
```

### Sidebar nav (top-level, in order)

Notification bell → Dashboard → Todos (`/tasks`) → Drafts → Projects (flyout:
List/Table/Cards) → Metrics (flyout: List/Bowling/Tiles) → Calendar → Chat (unread
badge) → Meet Hub → Users (Admin/Manager only) → Organization (Admin/Manager only) →
Settings. Bottom: Profile + Logout (guarded by a confirm dialog if a call/meeting is
active). A "show/hide project list" toggle appears only while on `/projects/:id`.

---

## 4. Feature flow summaries

**Auth** — JWT access + refresh token, `authGuard`/`guestGuard`/`roleGuard` on the
frontend, `protect`/`allowRoles` middleware on the backend. New users likely go
through an org invite (`Invite` model, `/accept-invite/:token`) rather than open
registration — check `authController`/`inviteRoutes` if this needs confirming.

**Projects → ProjectItem tree** — `Project` has a tree of `ProjectItem` rows
(`type`: group/task/subtask), rendered via `project-tree-node` (tree view) or
`kanban-board` (board view) inside `project-detail`. The older standalone `Task`
model (`task-list`, `edit-task`) is a **separate, legacy** concept from
`ProjectItem` — don't conflate the two when reading code.

**Task Approval** — built on `ProjectItem`, not `Task` (see `TASK_APPROVAL_PROGRESS.md`).
Thumb icon on a project-tree row opens `task-approval-modal`: assign approvers →
approve/request changes → threaded discussion → re-request → completion gated on
all active approvers being `approved` (checked in both direct status updates and
the ancestor status-rollup in `statusSync.service.ts`).

**Calendar** — `Calendar` (container) → `CalendarEvent` (with recurrence via
`RecurringRule` + `EventException` for per-occurrence skip/modify), rendered with
`angular-calendar` in day/week/month views sharing one `CalendarStateService`.
Occurrences are expanded server-side per request, not materialized as rows.

**Meet Hub (video meetings)** — `Meeting`/`MeetingParticipant`/`MeetingSettings`,
reachable from 4 entry points: Meet Hub landing page (`/meet-hub`), a Calendar
event's "Add Meet Hub room" toggle, a Project's "Schedule Meeting" action, or a
Group chat's call buttons. All routes converge on the same lobby → `/meet/:roomCode`
room UI, native mesh WebRTC (Socket.IO room signaling), capped at 4 participants.
1:1 chat calls are a **separate**, older code path (`call:*` socket events,
`chat.component.ts`) not yet unified onto the `Meeting` model — see `call-bugs.md`
for known issues there (no org-scoping, blocklist bypass, multi-tab bugs, etc.).

**Chat & Groups** — 1:1 DMs (`Message`, `chatController`) and Groups (`Group`/
`GroupMember`/`GroupMessage`, `groupController`) are two separate, parallel systems
sharing UI inside one `chat.component.ts` (DM sidebar tab + Groups tab). Groups
support their own call buttons (→ Meet Hub, group-scoped `Meeting`).

**Metrics (KPIs)** — `Metric` config lives in Postgres (direction: higher/lower/
target-range, optional department scoping). Daily actual/target tracking lives in
**MongoDB** (`MetricTracking`, only `daily` frequency implemented today) — this is
intentionally split: config is relational, tracking data is document-shaped and
high-write. Three frontend views: `metrics` (config list), `metric-bowling`
(spreadsheet-style daily entry grid), `metric-tiles` (gauge dashboard).

**Notifications** — `Notification` rows persisted + pushed live via
`emitToUser`/`notifications-feed.service.ts` + the sidebar bell. Fired by
`utils/notifications.ts`'s `notifyUser` from many controllers (meetings, groups,
task approval, etc.) — check `NotificationType` enum in `notification.prisma` for
the full current list of trigger types.

---

## 5. Known rough edges (from existing docs, unverified/unfixed as of writing)

- 1:1 calling has real security gaps: no org-scoping, blocklist bypass, static
  non-expiring TURN creds, multi-tab breakage — full list in `call-bugs.md`.
- Attachment/plan preview can silently fail to load behind ad-blockers (blob-fetch
  pattern flagged as tracking-like) — fix planned in `TODO-attachment-direct-url-refactor.md`.
- Meet Hub: no waiting-room/"ask to join" flow yet, no dedicated participant-list
  panel, SFU (>4 participants) deliberately deferred pending usage data.
- Calendar: no Calendar (container) management UI, no guest RSVP flow, no
  attachment upload wired to events yet, no reminder delivery mechanism.
- `pages/task-form/` appears to be dead code (not routed) — confirm before touching.
- Backend rate limiting (`globalLimiter`/`authLimiter`) is present in code but not
  actually applied to any route.
