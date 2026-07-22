# Backend: Gradual JavaScript → TypeScript Migration

> **Execution mode**: running as a **batched** migration (convert a whole phase's files together,
> verify with `tsc --noEmit` + a `tsx` boot smoke test, rather than one file per commit) since this
> environment has no `.env`/`DATABASE_URL` to actually run the app against a real database — live
> endpoint testing has to happen in your own environment, not here. Each file's old `.js` is deleted
> as soon as its `.ts` replacement is verified, with an entry logged in **[removed.md](./removed.md)**
> — see the note under Tooling setup for why that required moving the `tsx` switch earlier than
> originally planned (was Phase 5, now done upfront).

## Why this is low-risk here

- The backend is already ESM (`"type": "module"` in `package.json`) with explicit `.js` extensions on every relative import (e.g. `from '../lib/prisma.js'`). This is exactly the convention TypeScript's `NodeNext` module resolution expects, so migrating a file to `.ts` requires **no import-path changes** anywhere else in the codebase.
- Prisma 7 already generates full types for every model/query. The moment a controller becomes `.ts`, every `prisma.task.findMany(...)` call is type-checked for free — no schema duplication needed.
- `allowJs` lets `.js` and `.ts` files `import` each other in the same build, so this can be done one file at a time with the server runnable after every single step. There is no "flag day."

## Goal

Migrate all 54 backend source files from `.js` to `.ts`, bottom-up by dependency order, with the app fully runnable (and, once test coverage exists, fully testable) after every individual file conversion — never a multi-file batch that has to land all at once.

## Tooling setup (one-time, before migrating any file)

1. **Add dev dependencies**: `typescript`, `tsx` (for `npm run dev`, replaces `nodemon` — handles ESM + TS natively, no loader flags), `@types/node`, plus `@types/` packages for untyped deps as needed (`@types/cookie-parser`, `@types/cors`, `@types/jsonwebtoken`, `@types/multer`, `@types/morgan`, `@types/nodemailer`). Express 5, socket.io, bullmq, ioredis, and the Prisma client all ship their own types — no `@types/*` needed for those.
2. **`tsconfig.json`** at `backend/` root:
   - `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` — matches the existing explicit-`.js`-extension import style exactly.
   - `"target": "ES2022"` (matches Node 18+ engine requirement already in `package.json`).
   - `"allowJs": true`, `"checkJs": false` — lets untouched `.js` files sit alongside `.ts` files and be imported by them, without forcing type-checking on files not yet migrated.
   - `"outDir": "dist"`, `"rootDir": "."`.
   - `"strict": true` from day one (matches the frontend's `tsconfig.json`, see prior audit) — easier to hold the line from the start than to retrofit strictness later once dozens of files exist with implicit `any`.
   - `"esModuleInterop": true`, `"skipLibCheck": true` (the latter avoids getting blocked by type issues inside third-party `.d.ts` files, e.g. older `multer-storage-cloudinary` typings).
3. **`package.json` scripts** — **revised from the original plan**: `"dev": "tsx watch index.js"` and `"start": "tsx index.js"` were switched **immediately** (not deferred to Phase 5), because deleting a migrated file's old `.js` the moment it's replaced (per the batched/removed.md approach — see the callout above) only works if the thing actually running the app can resolve a `.js` import specifier to a sibling `.ts` file. Plain `node` cannot do this; `tsx` can. `nodemon` was dropped from these scripts as a result (still an installed dep for now; safe to remove once nothing references it). The original plan's `"build": "tsc"` + `"start": "node dist/index.js"` (compiled output, no runtime TS dependency in prod) becomes the **actual** Phase 5 step instead — see Phase 5 below.
   - Added `"type-check": "tsc --noEmit"` as the primary verification command for this migration.
   - Kept `prisma:*` scripts unchanged.
4. Verified after setup: `npm run type-check` passed with zero `.ts` files present, and a `tsx index.js` boot smoke test reached the same external-service log lines (Postgres/Mongo/Redis) the pre-migration `.js` version would — confirming the switch to `tsx` itself introduced no behavior change before any file migration began.

## Migration principles (apply to every file)

- **Batched per phase, not one file per commit.** Convert a phase's files together, verify the whole batch with `npm run type-check` plus a `tsx` boot smoke test, then delete the old `.js` files and log each in [removed.md](./removed.md) in the same step.
- **No behavior changes riding along.** A migration commit only adds types — it does not refactor logic, rename variables, or "clean up while I'm in there." If a real bug is spotted mid-migration, note it separately and fix it in its own commit.
- Import specifiers **keep their `.js` extension** even after the source file becomes `.ts` (e.g. `import prisma from '../lib/prisma.js'` still points at what is now `lib/prisma.ts`) — this is correct and required under `NodeNext` resolution, not a leftover mistake.
- Where a file's shape is genuinely dynamic (e.g. a JSON blob column, a third-party webhook payload), prefer a named `interface`/`type` over reaching for `any` — the frontend audit already found the codebase holds this line well; keep holding it here.
- Express handler signatures: type as `(req: Request, res: Response, next: NextFunction)` from `express` — resist the urge to widen `req.user` to `any`; instead extend Express's `Request` type once (see Phase 1) so `req.user` is typed everywhere without per-file casts.

## Migration order (bottom-up by dependency — leaves first, entrypoint last)

Grounded in the actual current file tree; each phase should only be started once the previous phase's files compile clean and the server runs.

### Phase 0 — Foundational utils & lib (no internal dependents yet)
```
lib/prisma.js
lib/redis.js
lib/s3.js
utils/AppError.js
utils/utils.js
utils/blobStorage.js
utils/mailer.js
utils/mentions.js
utils/counter.js
utils/sequence.js
```
`lib/prisma.ts` matters most here — it's the one file every controller ultimately imports through, so getting its typed export right (the `PrismaClient` instance) unblocks everything downstream.

### Phase 1 — Middleware & cross-cutting utils (depend on Phase 0)
```
middleware/errorMiddleware.js
middleware/authMiddleware.js
middleware/roleMiddleware.js
middleware/validate.js
middleware/upload.js
middleware/attachmentUpload.js
utils/access.js
utils/notifications.js
```
This is also the right moment to add an Express `Request` augmentation (e.g. `declare module 'express-serve-static-core' { interface Request { user?: User } }` in a `types/express.d.ts`) so every later controller gets a typed `req.user` without a cast — do this once here, not repeatedly per controller later.

### Phase 2 — Background jobs, queues, sockets (depend on Phases 0-1)
```
services/statusSync.service.js
queues/userDeactivationQueue.js
jobs/attachmentSweeper.js
workers/userDeactivationWorker.js
socket.js
```

### Phase 3 — Controllers (depend on Phases 0-2)
```
controllers/authController.js
controllers/userController.js
controllers/organizationController.js
controllers/departmentController.js
controllers/categoryController.js
controllers/tagController.js
controllers/projectRoleController.js
controllers/projectController.js
controllers/projectItemController.js
controllers/projectMemberController.js
controllers/projectCommentController.js
controllers/attachmentController.js
controllers/taskController.js
controllers/notificationController.js
controllers/chatController.js
controllers/dashboardController.js
```
Suggested inner order: `authController` first (smallest blast radius to verify login/register/me still work end-to-end), then roughly largest-file-first since those tend to surface the most `any`/null-handling issues early while the pattern is fresh.

### Phase 4 — Routes (depend on Phase 3 controllers + Phase 1 middleware)
```
routes/authRoutes.js
routes/userRoutes.js
routes/organizationRoutes.js
routes/departmentRoutes.js
routes/categoryRoutes.js
routes/tagRoutes.js
routes/projectRoleRoutes.js
routes/projectRoutes.js
routes/taskRoutes.js
routes/notificationRoutes.js
routes/chatRoutes.js
routes/dashboardRoutes.js
```
Routes are thin (just `Router()` wiring) — this phase should be mechanical and fast.

### Phase 5 — Entry point & standalone script (last, depends on everything)
```
index.js
scripts/migrateTaskStatus.js
```
**Done.** `npm run build` (`tsc` → `dist/`) verified clean; `"start"` switched from `tsx index.js` to `node dist/index.js` (compiled output, no runtime TS dependency in prod) and boot-tested identically to every prior phase's `tsx` smoke test. `"dev"` stays on `tsx watch index.ts` for fast iteration.

`allowJs`/`checkJs` have since been **removed from `tsconfig.json`** (not just turned off) now that `models/Counter.js` was also migrated — see below — and `include` narrowed to `**/*.ts` only. No `.js` source files remain anywhere in the tree.

Added `backend/.gitignore` (didn't exist before) covering `dist/` — the build output is a new, regeneratable artifact directory this migration introduced, and the repo had no `.gitignore` catching it.

### Originally out of scope — migrated anyway on request
- `models/Counter.js` → `models/Counter.ts` — a Mongoose model for the legacy MongoDB connection; nothing reads/writes it besides `utils/counter.ts`. Initially left as `.js` since it's dead code, but migrated afterward at the user's request. See `removed.md` for the `Document<string>` typing note.

## Known friction points to expect (from real gaps found in this codebase)

- **`req.user` typing**: currently attached ad-hoc by `authMiddleware.js` with no type; fix once via the Express `Request` augmentation in Phase 1 (see above) rather than per-controller casts.
- **Prisma nullability**: fields like `Project.department`/`Project.owner` are optional relations — Prisma's generated types will correctly surface `null`, and code that currently assumes a value is present (no optional chaining) will now fail `tsc` where it was silently trusting the JS. Fix these as real null-safety improvements, not by widening to `any`.
- **`bullmq`/`ioredis`**: well-typed, should be close to friction-free.
- **`multer-storage-cloudinary`**: thin/older community types — may need a local `.d.ts` shim or `skipLibCheck` reliance rather than fighting its types directly.
- **`mongoose`**: only touched by `lib/` connection setup and the unused `Counter` model; low priority, low risk.
- **Socket.io event payloads**: `socket.js` currently passes untyped payloads over `emit`/`on` — worth defining a shared `interface ServerToClientEvents` / `ClientToServerEvents` here rather than leaving them as implicit `any`, since this is exactly the kind of "dynamic-looking but actually fixed-shape" data the frontend audit flagged as worth a real type over `any`.

## Definition of done (per phase)

- [ ] Every file in the phase renamed `.js` → `.ts`
- [ ] `npm run type-check` passes with no new errors introduced
- [ ] No `any` added except where genuinely justified (documented inline why, per existing codebase convention of commenting non-obvious decisions)
- [ ] `tsx index.js` boot smoke test reaches the same point it did before this phase (module graph resolves; no new runtime error introduced by the migration itself — this environment can't get further than that with no real DB/Redis/Mongo to connect to)
- [ ] Old `.js` files deleted, each logged in [removed.md](./removed.md)
- [ ] **You** manually exercise the affected endpoints/flows against a real environment — this is the one step that can't be verified from here

Batch is migration-only — no behavior/logic changes bundled in.

## Rollback

Because each phase is additive and `allowJs` keeps mixed `.js`/`.ts` working throughout, rolling back any single file is just reverting that one commit — it never blocks or depends on later phases having happened.

## Progress tracking

| Phase | Files | Status |
|---|---|---|
| Tooling setup | tsconfig, scripts, dev deps | **Done** |
| 0 — Foundational utils/lib | 10 files | **Done** |
| 1 — Middleware & cross-cutting utils | 8 files | **Done** |
| 2 — Jobs/queues/sockets | 5 files | **Done** |
| 3 — Controllers | 16 files | **Done** |
| 4 — Routes | 12 files | **Done** |
| 5 — Entry point & script | 2 files | **Done** |

**Migration complete** — all 55 files (54 originally in scope + `models/Counter.js`, migrated afterward on request) are now `.ts`. Zero `.js` source files remain in the tree. Production runs compiled output (`npm run build && npm start`); dev runs `tsx` directly.

Update the Status column as phases complete (`Not started` → `In progress` → `Done`), and note the date + any deviations from the plan inline.
