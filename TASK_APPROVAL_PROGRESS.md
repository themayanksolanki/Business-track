# Task Approval — Progress

Implementation of the Task Approval feature spec (thumb icon on Project Details rows →
approval modal → approver assignment → approve/request-changes → discussion → re-request →
completion gating → audit history), split into a Phase A slice (data model, backend, minimal
modal) and a Phase B slice (discussion/history UI, row badge, notification types, gap audits)
— both now implemented. See `C:\Users\MayankSolanki\.claude\plans\serene-watching-koala.md`
for the plans this was implemented from.

**Target model:** the feature is built on `ProjectItem` (Project Details page tree — types
`group`/`task`/`subtask`), not the separate legacy `Task` model, since "Group" as a concept
only exists on `ProjectItem`.

**Verified so far:** Prisma schema validates (`prisma validate`/`generate`, no live DB in this
environment — migration is still the user's responsibility, see below), backend
`tsc --noEmit` passes, frontend `tsc --noEmit` and `ng build` both pass. No manual/live
end-to-end testing has been done (no dev DB/server available here).

---

## ✅ Done (Phase A)

### Data model
- New `backend/prisma/schema/taskApproval.prisma`: `TaskApprover` (one row per
  item+approver, `status`: pending/approved/changesRequested/cancelled — removal cancels
  rather than deletes, for audit history), `ApprovalHistory` (append-only audit log),
  `ApprovalComment` (separate from the existing generic item `Comment` model — has
  `isEdited`/`editedAt`/`replyToId` self-relation for threaded replies, which `Comment`
  doesn't have).
- `ProjectItem`/`User` back-relations added; `NotificationType` extended with
  `taskApprovalRequested`, `taskApproved`, `taskChangesRequested`, `taskApprovalReRequested`,
  `taskFullyApproved`, `taskApprovalCommentAdded`.
- **Not migrated against any database** — no `.env`/`DATABASE_URL` in this environment, so
  only schema-only `prisma validate`/`generate` were run. Run `prisma migrate dev` (dev DB)
  then `prisma migrate deploy` (production) yourself; the change is purely additive (two new
  tables, new enum values) and touches no existing columns or rows.

### Backend (`backend/controllers/taskApprovalController.ts`, mounted in `projectRoutes.ts`)
- `GET/POST /:projectId/items/:itemId/approvers`, `DELETE .../approvers/:userId` — assign/
  remove approvers, gated to Task Owner (`assignedToId`)/Task Creator (`createdById`)/"Project
  Admin" (see assumption below). Assigning validates against active project members.
- `POST .../approve`, `POST .../request-changes` (comment required) — gated to the caller
  having an active `TaskApprover` row. Progress/eligibility is always computed live from
  non-cancelled rows, never cached, so it's inherently "recalculated immediately."
- `POST .../re-request` — resets only `changesRequested` approvers back to `pending`,
  notifies only them, leaves `approved` rows untouched.
- `GET .../approval-history` — full audit trail (approver assigned/removed, approved, changes
  requested, comment added/edited/deleted, re-requested), newest first.
- `GET/POST/PATCH/DELETE .../approval-comments` — full CRUD, author-only edit/delete
  (mirrors the existing project-item `Comment` authorization rule), edit sets
  `isEdited`/`editedAt`.
- Notifications fired via the existing `notifyUser`/`notifyUsers` helper
  (`backend/utils/notifications.ts`) for: approver assigned, approved, changes requested,
  re-requested, all-approved, and comment added — matching the spec's notification rules.

### Completion gating
- `backend/utils/approval.ts`'s `isApprovalCompleteForItem()` (true if zero active approvers,
  or all active approvers are `approved`) is checked in two places:
  - `projectItemController.ts`'s direct status-set validation — a 400 with a clear message if
    completing an item that isn't fully approved.
  - `statusSync.service.ts`'s ancestor status rollup — a parent task with subtasks can't
    auto-roll-up to `completed` via its children finishing if the parent itself has pending
    approvers.

### Frontend
- `frontend/src/app/models/task-approval.model.ts` + `core/services/task-approval.service.ts`
  — thin HTTP wrapper mirroring the routes above.
- Thumb icon (`bi-hand-thumbs-up`) added to `project-tree-node.component.html`, next to the
  existing attachment/description icons — **visible on both Task and Group rows** (unlike
  attachments/description, which hide on groups), per the spec. Also added to the `⋮`
  context-menu fallback for narrow screens.
- `frontend/src/app/shared/task-approval-modal/` (`TaskApprovalModalComponent`) — modeled on
  `TaskAttachmentsModalComponent`'s modal skeleton: approver multi-select/search (add-only
  UI; management gated client-side by an approximation of the server's rule — see below),
  per-approver status list, progress bar/fraction, Approve/Request Changes buttons for the
  current user if they're an active approver, Re-request Approval button for whoever can
  manage approvers when ≥1 approver has requested changes.

---

## ✅ Interpretation calls — confirmed with the user, no changes needed

- **"Project Admin"**: confirmed as the existing `canManageProjectSettings` check (org
  `Admin`/`Manager`, or the project's own `createdById`/`ownerId`) — no dedicated
  project-admin flag needed.
- **Groups and completion**: confirmed acceptable — Groups get full approver/approval-modal
  support (assign, approve, request changes), but the "cannot be marked Completed" gate stays
  a no-op for Groups, since `statusSync.service.ts` already treats groups as never having a
  completable status at all (pre-existing, not something this feature changed). Groups
  participate in the approvers feature only, not in completion gating.
- **"Add, update, or remove approvers"**: confirmed add (`POST`) + remove (`DELETE`) is
  sufficient — no separate "update" action needed.
- **Who can post approval comments**: confirmed as any project member with edit access
  (`canEditProject`), matching the existing generic project-item `Comment` feature's
  permissiveness — not restricted to just assigned approvers/Task Owner/Creator/Admin.

---

## ✅ Done (Phase B)

- **Discussion thread UI inside the modal.** `TaskApprovalModalComponent` now has a
  Approvers/Comments/History tab bar. The Comments tab lists all `ApprovalComment` rows
  (author, timestamp, "edited" badge), supports full CRUD (author-only edit/delete, matching
  the backend's own restriction), and supports replies via a reply-preview composer bar +
  an inline quoted-parent block on the reply itself (parent resolved client-side from the
  already-loaded flat list, since the backend doesn't nest it). Modeled on
  `project-item-detail.component`'s existing comment pattern and `chat.component`'s
  reply-preview/quoted-reply/edited-badge patterns.
- **Approval history UI.** The History tab renders `GET .../approval-history` as a flat
  timeline (author, human-readable action label, optional detail, timestamp) — built from
  scratch, no prior timeline component existed to reuse.
- **Row-level pending-approver badge.** `getItems`'s non-paginated and paginated branches both
  now merge a `taskApprover.groupBy` (mirrors the existing `getItemsSummary` read-time
  aggregation pattern rather than a denormalized column, since approver mutations happen from
  five different controller functions) into each item as `approverCount`/
  `pendingApproverCount`. The thumb icon shows a count badge and lights up whenever
  `pendingApproverCount > 0`, exactly like the paperclip icon's `attachmentCount` badge.
- **Notification UI surfacing.** The 6 new `NotificationType` values are added to the
  frontend's type union. No further UI work was actually needed: there's no per-type icon/copy
  lookup table anywhere in the app — notification `title`/`message` are pre-baked strings
  written server-side (Phase A's `notifyUser` calls), and `NotificationsFeedService.linkFor()`
  already generically routes any notification carrying both `projectId` and `projectItemId` to
  that project's Tasks tab. **Explicitly out of scope**: deep-linking a notification click to a
  highlighted approval comment / auto-opening the approval modal (the equivalent of
  `highlightCommentId` for the item-comment thread) — none of Phase A's `notifyUser` calls for
  these 6 types pass a `commentId`, so clicking one opens the item but doesn't scroll to a
  specific comment. Flagging as a further-deferred item rather than building it speculatively.
- **Completion-gate coverage audit.** Traced every write to `ProjectItem.status`: only
  `updateItem` (gated since Phase A) and `statusSync.service.ts`'s ancestor rollup (self-gated
  since Phase A). Every frontend status-changing surface (tree dropdown, Kanban drag-and-drop,
  Kanban quick-add) routes through the same gated `updateItem` endpoint — no other write path
  exists. No gap found; no code changes were needed.
- **Mobile/responsive polish.** Re-checked the existing hide-below-860px + `⋮` context-menu
  fallback pattern already applied to the thumb icon in Phase A — no further gap found. The new
  modal tab bar also gets a horizontal-scroll fallback below 860px.

## ⬜ Remaining

- **Per-approval-cycle discussion segmentation** — explicitly descoped by the user ("keep flat
  for now"). The comment thread stays flat across re-request cycles; a re-request doesn't
  visually separate "old" feedback from the new round. No schema change (no `cycle` counter)
  was made.
- **Manual end-to-end QA.** No dev database/server is available in this environment — only
  compile-time verification (`tsc`, `ng build`) has been done for both Phase A and Phase B.
  Please exercise the full flow (assign → approve/request changes → discuss/reply/edit →
  re-request → complete → row badge → notifications) against a real dev environment before
  relying on this.
