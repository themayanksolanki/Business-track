# Metrics (KPI Tracker) Feature

## Context

The user wants to track day-to-day business KPIs (e.g. daily sales, daily crime count, daily factory chemical usage) as a standalone feature, distinct from Projects/Tasks. Each metric has a target "direction" (higher-is-better, lower-is-better, or must-stay-in-range), and a month-at-a-time table of daily entries (value, notes, and optional links to specific project tasks relevant that day). The data-entry grid will use Handsontable + its Formulas plugin for a spreadsheet-native feel (e.g. a computed monthly total row), rather than a hand-rolled table.

Confirmed decisions:
- Standalone top-level section (new sidebar item + routes), not nested under Project.
- `targetRange` direction uses a simple min/max bound (no tolerance color bands).
- The "total" concept is a Handsontable formula (summary row), not a manually-typed or backend-stored field.
- Permissions are single-tier: anyone who can access a metric can also edit its config and enter daily data (no separate edit-vs-view split, unlike Project).
- A metric with no department set is org-wide visible (there's no membership list to fall back to, unlike Project).
- Handsontable's commercial license (~$899–979+/dev/yr) applies for real business use, but the user confirmed this app is live only internally without market users — proceed with the free `'non-commercial-and-evaluation'` license key now, wired as a single swappable config constant, to revisit if that changes.

## 14. Daily Metric Bowling View (new)

### Context

On top of the Metric config feature above, the user wants a "bowling view" — a spreadsheet-like dashboard for entering and reviewing daily Actual/Target numbers per metric, one month at a time, 15 days visible at once. This is a fundamentally different data shape from the Metric config (which lives in Postgres): daily numbers are per-metric-per-day, high write frequency, and the user explicitly wants them stored in **MongoDB** (already connected but currently unused by any real feature — this is its first live use) rather than Postgres. The user also wants the storage/API layer built generically around a **frequency** dimension (`daily` now; `weekly`/`monthly`/`quarterly`/`yearly` later) so adding those later doesn't require reshaping the model — only `daily` is actually implemented in this pass.

Confirmed decisions:
- Target is entered **per day**, exactly like Actual (not a single fixed target per metric).
- This is a **new, separate page/route** (`/metrics/bowling`), not a view-mode toggle on the existing list page — the two have fundamentally different data/state (a fetched `Metric[]` array vs. per-metric month-window state), so a distinct component makes more sense than cramming both into one template the way Projects' List/Table/Cards toggle does for a single shared array.
- Merging edits into stored data and recomputing Actual/Target monthly totals happens in **backend application code** (plain JS read-merge-write), not via MongoDB update operators (`$inc`/aggregation) — Mongo is just a document store here.
- The frontend computes a **lodash deep-diff** of only the changed days (via the `_.transform` + `_.isEqual` recipe — plain lodash has no built-in "diff" function) and sends just that in the PUT payload.
- **Metric creation fields are changing**: Category becomes optional (was required), Owner becomes required (was optional, defaulted to creator) — matches this spec's Name/Department/Owner creation flow. Requires a schema migration (`categoryId` → nullable, `ownerId` → required) plus matching validate.ts/controller/frontend changes.
- **Open assumption to confirm before implementing**: the Month/Date header row — built as **one shared header at the top of the page** (not repeated per metric section), with each metric below contributing just its own Actual row + Target row + Total. This reads as the more sensible interpretation of the spec's ASCII diagram (which shows one unified header), but section 5's prose could be read as "repeat the header per metric" — flagging this explicitly since it changes the component structure.

### 14.1 Metric required-field swap (Postgres)

- `metric.prisma`: `categoryId Int?` / `category Category? @relation(...)`; `ownerId Int` (required) / `owner User @relation("MetricOwner", ...)`.
- New migration `..._metric_owner_required_category_optional`: backfill safety (`UPDATE metrics SET "ownerId" = "createdById" WHERE "ownerId" IS NULL` — should be a no-op today since `createMetric` already always populates it, but matches this repo's backfill-before-constrain convention), then `ALTER COLUMN "categoryId" DROP NOT NULL`, `ALTER COLUMN "ownerId" SET NOT NULL`, and swap each FK's `ON DELETE` action (`categoryId`: RESTRICT → SET NULL; `ownerId`: SET NULL → RESTRICT — mirrors how Prisma already treats optional-vs-required FKs elsewhere in this schema, e.g. `Project.categoryId`/`createdById`).
- `validate.ts` `validateMetric`: drop the POST-time `!category` required check; add a POST-time `!owner` required check (keep the existing `isValidId` shape check for both methods).
- `metricController.ts`: `createMetric` — `categoryId: category ? Number(category) : null`, `ownerId: Number(owner)` (no more default-to-creator, since it's now a validated required field). `updateMetric` — `if (owner !== undefined) data.ownerId = Number(owner)` (no more `: null` fallback, since owner can no longer be unset).
- Frontend `metric.model.ts`: `category` becomes nullable in `Metric`, `CreateMetricPayload.owner: number` (required), `category?: number | null`. `metric-form-modal.component.ts`/`.html`: swap the required-check and the `*` asterisk between Owner and Category fields.

### 14.2 Backend: generic frequency-based tracking data (MongoDB)

New file `backend/models/metricTracking.model.ts` — first real Mongoose model in this app (no existing model-file convention to follow; `mongoose.connect()` in `backend/index.ts` establishes the default connection, so this just calls `mongoose.model(...)` against it directly, same as the one-off `migrateTaskStatus.ts` script did):

```ts
export type MetricFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const periodSchema = new mongoose.Schema({ actual: Number, target: Number }, { _id: false });

const metricTrackingSchema = new mongoose.Schema({
  metricId: { type: Number, required: true },       // Postgres Metric.id
  frequency: { type: String, enum: ['daily','weekly','monthly','quarterly','yearly'], required: true },
  year: { type: Number, required: true },
  month: { type: Number, default: null },            // only meaningful for frequency === 'daily'
  periods: { type: Map, of: periodSchema, default: {} }, // keyed "1".."N" — meaning of N depends on frequency
  actualTotal: { type: Number, default: 0 },
  targetTotal: { type: Number, default: 0 },
}, { timestamps: true });

metricTrackingSchema.index({ metricId: 1, frequency: 1, year: 1, month: 1 }, { unique: true });
```

`backend/utils/metricPeriods.ts` — the one piece of frequency-generic logic actually needed now, kept small and honest about what's implemented:

```ts
// Only 'daily' is implemented — the other branches exist so the storage/API
// layer doesn't need reshaping when they're built, not because they work yet.
export function periodCount(frequency: MetricFrequency, year: number, month?: number | null): number {
  if (frequency === 'daily') return dayjs(`${year}-${month}-01`).daysInMonth();
  throw new Error(`periodCount: frequency '${frequency}' not implemented yet`);
}
```

New `backend/controllers/metricTrackingController.ts` (kept separate from `metricController.ts` — same convention as `projectItemController.ts` being separate from `projectController.ts` for a related-but-distinct concern):
- `getPeriodData` — `GET /api/metrics/:metricId/tracking/:frequency?year=&month=`: loads the Postgres `Metric` row, runs the existing exported `canAccessMetric` check, then reads (or returns an empty-shape default for) the matching Mongo doc — `{ periods: {}, actualTotal: 0, targetTotal: 0 }` if none exists yet (no need to pre-create empty documents).
- `savePeriodDiff` — `PUT /api/metrics/:metricId/tracking/:frequency?year=&month=`, body `{ diff: { "5": { actual: 120 }, "6": { target: 80 } } }`: same access check, then **in application code** (not Mongo operators) — fetch-or-init the doc, `{...current, ...diff}`-merge each touched period key, recompute `actualTotal`/`targetTotal` via a plain JS sum over `periods.values()`, `doc.save()`, return the updated `{periods, actualTotal, targetTotal}`.
- Both validate `frequency === 'daily'` for now (`AppError('Only daily tracking is implemented', 400)` otherwise) and `year`/`month`/diff-key-range via a new `validateTrackingParams`/`validateTrackingDiff` pair in `validate.ts` (day keys must be within `periodCount('daily', year, month)`, values numeric-or-null).

Routes added to `metricRoutes.ts` (same resource family, same file):
```
router.get('/:metricId/tracking/:frequency', protect, validateMetricId, validateTrackingParams, getPeriodData);
router.put('/:metricId/tracking/:frequency', protect, validateMetricId, validateTrackingParams, validateTrackingDiff, savePeriodDiff);
```

### 14.3 Frontend

- `frontend/src/app/models/metric-tracking.model.ts` — `MetricFrequency` type, `PeriodValue { actual: number|null; target: number|null }`, `MetricTrackingData { periods: Record<string, PeriodValue>; actualTotal: number; targetTotal: number }`.
- `MetricService` gets two more methods (`// Tracking` banner): `getTracking(metricId, frequency, year, month)`, `saveTrackingDiff(metricId, frequency, year, month, diff)` — all parameterized by `frequency` (passed `'daily'` today) rather than a hardcoded path segment, so a future weekly view reuses the same methods.
- New page `frontend/src/app/pages/metric-bowling/metric-bowling.component.*`, route `/metrics/bowling` (`canActivate:[authGuard]`), reached via a plain second link (not a shared view-mode signal, per the decision above) alongside `/metrics` — either as a `nav-item-group` submenu under the sidebar's Metrics entry (mirroring Projects' List/Table/Cards submenu markup, `sidebar.component.html:81-109`) or a simple in-page tab; submenu mirrors the existing pattern most closely.
- Component state: `selectedYear`/`selectedMonth` (a plain `<input type="month">`), `windowIndex` (0-based 15-day page), `daysInMonth` via `dayjs(...).daysInMonth()`, `totalWindows = Math.ceil(daysInMonth/15)`, `visibleDays` = the slice for the current window. Per metric: `periods` (current, mutable), `originalPeriods` (pristine snapshot taken right after load — the diff base), `actualTotal`/`targetTotal` (server-authoritative, replaced after each save).
- **Layout** — three-column flex per metric row, avoiding `position: sticky` entirely (no existing precedent for a frozen-left-column pattern in this app, per research — simpler to just not need one):
  1. Left, fixed-width, no horizontal scroll: Name/Department/Owner.
  2. Middle, `overflow-x: auto`, the `visibleDays` cells for Actual + Target rows.
  3. Right, fixed-width, no horizontal scroll: Total column (Actual Total, Target Total) — genuinely always visible because it's structurally outside the scrolling middle column, not because it's `position: sticky` inside it.
  One shared Prev-15/Next-15 control pair for the whole page (all metrics share the same window/month state).
- **Cell editing** — follows the closest existing precedent (`project-tree-node.component.ts`'s inline-edit-via-element-swap technique: a read-mode `<span>` swapped for an `<input>` on click, `@ViewChild` + focus after render) but extends it with what that component doesn't have: Esc-cancel-restore, Tab/Shift+Tab-save-and-move, and arrow-key navigation — built fresh since no existing component covers those. Tab order: all of a metric's Actual-row cells left-to-right, then its Target-row cells left-to-right; arrow keys move Left/Right within a row and Up/Down between the two rows at the same day.
- **Validation**: numeric-only on commit (Enter/Tab/blur) — invalid input keeps the cell in edit mode with inline error styling instead of exiting (per spec §11), same as how `validateMetric`-style inline errors already work elsewhere in this app's forms.
- **Save flow**: on each commit, update local state optimistically (instant total recompute client-side for responsiveness), compute the lodash deep-diff of `periods` vs `originalPeriods` (`_.transform`+`_.isEqual` recipe — needs `@types/lodash` added to `backend/package.json` devDependencies too, since only the frontend currently has `@types/lodash-es`), debounce ~400-500ms so rapid multi-cell edits batch into one PUT, then on success replace `originalPeriods` with the merged result and adopt the server-returned `actualTotal`/`targetTotal` as authoritative.

### Verification
1. `cd backend && npx prisma migrate dev` (or `validate`/`generate` if no reachable DB) for the owner/category swap migration; `npx tsc --noEmit`.
2. Manually exercise: create a metric with only Name/Department/Owner (Category omitted) — should succeed; omitting Owner should now fail.
3. Hit the new tracking endpoints directly (or via the UI): PUT a diff for a couple of days, confirm `actualTotal`/`targetTotal` come back correctly summed, confirm a second PUT with a different diff doesn't clobber untouched days.
4. In the Bowling View: create/open a month with 31 days, confirm 3 windows (1-15, 16-30, 31), confirm Total doesn't change when paging between windows, confirm Enter/Esc/Tab/Shift+Tab/arrows behave per spec, confirm an invalid (non-numeric) entry keeps the cell in edit mode.

## 1. Prisma Schema

New file `backend/prisma/schema/metric.prisma`:

```prisma
enum MetricDirection { higherIsBetter lowerIsBetter targetRange }
enum MetricStatus { active archived }

model Metric {
  id             Int             @id @default(autoincrement())
  sequenceId     Int?
  organizationId Int?
  departmentId   Int?            // null = org-wide visible (see canAccessMetric)
  name           String
  unit           String
  direction      MetricDirection
  targetMin      Float?          // only meaningful when direction = targetRange
  targetMax      Float?
  status         MetricStatus    @default(active)
  createdById    Int
  updatedById    Int?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  organization Organization? @relation(fields: [organizationId], references: [id])
  department   Department?   @relation(fields: [departmentId], references: [id])
  createdBy    User          @relation("MetricCreatedBy", fields: [createdById], references: [id])
  updatedBy    User?         @relation("MetricUpdatedBy", fields: [updatedById], references: [id])
  entries      MetricEntry[]

  @@index([organizationId])
  @@unique([organizationId, sequenceId])
  @@map("metrics")
}

model MetricEntry {
  id          Int      @id @default(autoincrement())
  metricId    Int
  date        DateTime @db.Date   // calendar day, no time component
  actual      Float?              // null = blank cell, distinct from entered 0
  notes       String   @default("")
  createdById Int
  updatedById Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  metric       Metric        @relation(fields: [metricId], references: [id], onDelete: Cascade)
  createdBy    User          @relation("MetricEntryCreatedBy", fields: [createdById], references: [id])
  updatedBy    User?         @relation("MetricEntryUpdatedBy", fields: [updatedById], references: [id])
  projectItems ProjectItem[] // implicit M:N, mirrors Tag<->ProjectItem (tag.prisma)

  @@unique([metricId, date])
  @@index([metricId, date])
  @@map("metric_entries")
}
```

Small additive edits to existing schema files:
- `sequence.prisma`: add `metric` to `SequenceEntity`.
- `projectItem.prisma`: add reverse relation `metricEntries MetricEntry[]`.
- `organization.prisma` / `department.prisma`: add `metrics Metric[]`.
- `user.prisma`: add `createdMetrics`/`updatedMetrics`/`createdMetricEntries`/`updatedMetricEntries` reverse relations (mirrors the existing `MetricCreatedBy`-style pairs already used for Project).

## 2. Migrations

Two new migrations under `backend/prisma/migrations/`, timestamped after `20260724000000_add_light_sidebar_themes`:

1. `..._add_metric_sequence_entity` — `ALTER TYPE "SequenceEntity" ADD VALUE 'metric';` (its own migration, per the existing convention for enum-value additions, see `20260721120000_add_draft_project_status`).
2. `..._add_metrics_and_metric_entries` — `CREATE TYPE` for `MetricDirection`/`MetricStatus`, `CREATE TABLE` for `metrics` and `metric_entries`, the implicit join table `_MetricEntryToProjectItem` (Prisma names it alphabetically: Metric**Entry** < Project**Item**), indexes, and FKs. No backfill needed (new feature, no existing rows).

## 3. Backend API

New `backend/controllers/metricController.ts` with a single access-check function reused for read and write (no edit/view split):

```ts
export const canAccessMetric = async (user: AuthUser, metric: MetricForAccess) => {
  if (metric.organizationId !== user.organizationId) return false;
  if (user.role === 'Admin') return true;
  if (!metric.departmentId) return true; // org-wide visible, confirmed
  const accessibleIds = await getAccessibleDepartmentIds(user);
  return canAccessDepartment(accessibleIds, metric.departmentId);
};
```

Routes, new `backend/routes/metricRoutes.ts` mounted at `/api/metrics` (each behind `protect` + validators, following `projectRoutes.ts`'s shape):

| Method | Path | Notes |
|---|---|---|
| GET | `/` | paginated, org/department-scoped list, `?status=` filter |
| POST | `/` | create; `validateMetric` |
| GET | `/:metricId` | `validateMetricId` |
| PUT | `/:metricId` | update config |
| DELETE | `/:metricId` | cascades entries + join rows |
| GET | `/:metricId/entries?year=&month=` | returns persisted rows only; frontend fills blank days |
| PUT | `/:metricId/entries/:date` | partial upsert `{ actual?, notes? }`, `:date` = `YYYY-MM-DD` |
| DELETE | `/:metricId/entries/:date` | clears a day back to blank |
| PUT | `/:metricId/entries/:date/links` | `{ projectItemIds: number[] }`, full-replace; upserts the entry row first if it doesn't exist yet |

New `backend/routes/projectItemRoutes.ts` mounted at top-level `/api/project-items` (separate from the existing project-scoped item routes — this is a cross-project search):

| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=&limit=` | new `searchProjectItems` export in `projectItemController.ts`; `type: { in: ['task','subtask'] }`, title `contains` (insensitive), org-scoped via `ProjectItem.organizationId` (confirmed to already exist directly on the model — no join through Project needed for org-scoping), then a `project: { OR: [...] }` department/ownership filter for non-Admins mirroring `getProjects`'s existing `where.OR` construction |

`backend/middleware/validate.ts` additions: `validateMetricId` (via the existing `validateParamId` factory), `validateMetric` (name/unit required, `direction` whitelist, `targetMin`/`targetMax` required together only when `direction === 'targetRange'` and `targetMin <= targetMax`), `validateMetricEntryDate` (`YYYY-MM-DD` param), `validateMetricEntry` (`actual` numeric-or-null, `notes` string), `validateEntryLinks` (array of valid ids, empty allowed to support unlinking all).

## 4. Frontend

- `frontend/src/app/models/metric.model.ts` — `Metric`, `MetricEntry`, `MetricDirection`/`MetricStatus` union types, `ProjectItemLite`, `Create/UpdateMetricPayload`, `UpsertMetricEntryPayload`, `PaginatedMetrics` (mirrors `project.model.ts` conventions).
- `frontend/src/app/core/services/metric.service.ts` — single service, `// Entries` banner section for entry endpoints (mirrors `project.service.ts`), plus a `searchProjectItems()` method for the task-link picker (lives here since it currently has one consumer).
- Pages:
  - `frontend/src/app/pages/metrics/metrics.component.*` — list page, same shape as `pages/projects/projects.component.ts`.
  - `frontend/src/app/pages/metric-detail/metric-detail.component.*` — month picker (dayjs, already a dependency) + Handsontable grid + inline metric-config editing (no separate settings tab, since there's no edit/view tier).
- Shared components:
  - `frontend/src/app/shared/metric-form-modal/` — create/edit metric config (name, unit, direction radio, min/max fields shown only for `targetRange`, department picker).
  - `frontend/src/app/shared/task-link-picker/` — modal with debounced remote search (`Subject → debounceTime(300) → switchMap(metricService.searchProjectItems)`) and multi-select checkboxes; closest existing precedent is `tag-picker.component.ts`'s dropdown pattern, adapted for remote search + multi-select instead of a preloaded list + single-select.
- Routes in `app.routes.ts`: `/metrics` and `/metrics/:id`, both `canActivate: [authGuard]`, lazy `loadComponent`.
- Sidebar: new top-level `<a routerLink="/metrics">` entry in `sidebar.component.html` (plain entry, no view-mode submenu). Add a `'metrics'` case to the icon union + `@switch` in `frontend/src/app/shared/icon/icon.component.ts`.

### Handsontable integration

Install: `handsontable @handsontable/angular-wrapper hyperformula` (none currently installed; wrapper is standalone-component-based, Angular 16+ compatible).

In `metric-detail.component.ts`:
- Import `HotTableComponent` from `@handsontable/angular-wrapper`, `registerAllModules()` from `handsontable/registry`, `HyperFormula` from `hyperformula`.
- Grid settings: `licenseKey: 'non-commercial-and-evaluation'` as a named constant (single place to swap later), `formulas: { engine: HyperFormula }`, `fixedRowsBottom: 1` for a pinned summary row.
- Rows: one per calendar day of the selected month + one trailing summary row (grid-display only, never persisted).
- Columns: Day (readOnly, derived), Actual (`type: 'numeric'`, format driven by `metric.unit`), Notes (`type: 'text'`), Linked Tasks (readOnly, custom renderer showing a pill list/"+N more"; click handled via `afterOnCellMouseDown` to open `task-link-picker`, excluding the summary row).
- Summary row's Actual cell holds a HyperFormula string (`=SUM(...)` for `higherIsBetter`/`lowerIsBetter`, `=AVERAGE(...)` for `targetRange`, since summing a must-stay-in-range metric isn't meaningful) — computed client-side, never sent to the backend.
- Persistence: `afterChange` hook, ignoring `source === 'loadData'` and the summary row; group dirty rows through a `Subject<number> → debounceTime(400)` and call `metricService.upsertEntry(metricId, date, { actual, notes })` per row (partial update, matches the controller's `if (x !== undefined)` pattern).
- Task-link picker: on confirm, call `metricService.setEntryLinks(metricId, date, ids)`, patch the row's `projectItems` locally, and call `hotInstance.render()` to refresh that cell.

Verify exact registration API (`registerAllModules`, `formulas.engine` shape, CSS import paths) against whatever version lands in `package.json` — these have shifted across recent Handsontable majors.

## Verification

1. `cd backend && npx prisma migrate dev` — apply the two new migrations, confirm `prisma generate` picks up the new `Metric`/`MetricEntry` types with no schema errors.
2. `cd backend && npx tsc --noEmit` — controllers/routes/middleware type-check.
3. Manually exercise the API: create a metric (each of the 3 directions), create/update entries for a month, link/unlink a project task to a day, confirm department-scoping (non-Admin user outside the metric's department gets 403/404; org-wide metric with no department is visible to any org member).
4. `cd frontend && npm start` — navigate to `/metrics`, create a metric of each direction, open its detail page, confirm the Handsontable grid renders the month, typing an Actual value persists (check network tab / reload confirms it stuck), the summary row's formula recalculates live, and the task-link picker searches and links a real project task.
5. Confirm sidebar nav entry and icon render correctly in both light/dark themes.
