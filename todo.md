# Todo

Follow-ups from recent feature work. Grouped by what's built-but-unverified
vs. discussed-but-not-built.

## Needs a live/visual check (code is done, not eyeballed in a browser)

- [ ] **Attachment thumbnail grid** — check tile spacing, hover overlay, and
      image-vs-icon rendering across all four surfaces: `attachment-panel`,
      `project-item-detail`, `project-attachments-card`, `task-attachments-modal`.
- [ ] **Sidebar Theme (Profile > Appearance)** — check all 6 presets render
      correctly, especially **Daylight** (the one light-background theme) for
      contrast; confirm the custom text-color picker's live drag-preview
      actually updates the real sidebar, not just the in-page preview swatch.
- [ ] **Meeting link (project item detail, below Created By)** — check badge
      wrapping with a long title in the sidebar's narrow column, and the
      add/edit form layout (URL + title + date/time pickers).
- [ ] **Notification gaps fill** (`projectItemAssigned` / `projectItemUpdated`)
      — end-to-end test: assign an item to someone, add/edit/remove a meeting
      link, confirm the notification bell updates live via socket and the
      message text is correct (esp. the meeting-link-specific wording).
- [ ] **Deleted-link handling** — click through a stale "Copy Task Link" to a
      since-deleted project item (should toast "no longer exists", not go
      silent) and open `/tasks/:id/edit` for a deleted task (should hide the
      form, not show a blank editable one).
- [ ] **Sidebar nav reorder** — visual check across all three roles (User,
      Team Lead, Admin/Manager) for spacing/grouping now that Chat/Notifications
      moved up and Settings moved to the end.
- [ ] **Team Tasks / My Team removal** — smoke-test a Team Lead login: confirm
      neither nav item appears, `/team-tasks` and `/users` are both
      inaccessible (redirect to dashboard), and nothing else on their
      dashboard/task views broke.

## Discussed, not built (explicitly offered as follow-ups)

- [ ] **Public, no-login video share links** (Loom-style) — every attachment
      route currently requires auth; a real public flow needs a signed/expiring
      per-attachment share token and a new unauthenticated route, not just a
      relaxed membership check.
- [ ] **Auto-rewrite pasted `loom.com/share/...` links to `loom.com/embed/...`**
      server-side, so users don't have to remember to grab Loom's embed URL
      manually for it to play inline.
- [ ] **Multi-device session management** ("log out everywhere" / active
      sessions list) — currently impossible since auth is fully stateless
      (no session/refresh-token table); would need real session tracking if
      ever wanted.
