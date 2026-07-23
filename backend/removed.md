# Removed Files Log

Tracks `.js` files deleted during the [TypeScript migration](./migration.md) once their `.ts`
replacement exists and every remaining importer has been confirmed to resolve to it (verified via
`npm run type-check` plus a `tsx` boot smoke test — see migration.md's Definition of Done). Each
entry is added in the same batch as the deletion, not after the fact.

| Removed file | Replaced by | Phase | Notes |
|---|---|---|---|
| `lib/prisma.js` | `lib/prisma.ts` | 0 | No behavior change; `connectionString` asserted non-null (existing runtime invariant, not newly enforced). |
| `lib/redis.js` | `lib/redis.ts` | 0 | Switched the internal `ioredis` import from default to named (`import { Redis }`) — a NodeNext/ESM interop requirement for this package's types, not a behavior change. External API (`export default connection`) unchanged. |
| `lib/s3.js` | `lib/s3.ts` | 0 | `S3StorageEngine` now formally implements multer's `StorageEngine` interface. |
| `utils/AppError.js` | `utils/AppError.ts` | 0 | |
| `utils/utils.js` | `utils/utils.ts` | 0 | |
| `utils/blobStorage.js` | `utils/blobStorage.ts` | 0 | `destroyBlob`'s param typed against Prisma's `StorageProvider` enum. |
| `utils/mailer.js` | `utils/mailer.ts` | 0 | |
| `utils/mentions.js` | `utils/mentions.ts` | 0 | Added a named `ValidatedMention` return type. |
| `utils/counter.js` | `utils/counter.ts` | 0 | Still imports the untouched (out-of-scope) `models/Counter.js` — see migration.md's "Not in scope" note. |
| `utils/sequence.js` | `utils/sequence.ts` | 0 | `tx` param typed as `Prisma.TransactionClient`, `entity` as the generated `SequenceEntity` enum. |
| `middleware/errorMiddleware.js` | `middleware/errorMiddleware.ts` | 1 | `err` kept as `any` — deliberately justified (heterogeneous Mongoose/Multer/Cloudinary/AWS/JWT error shapes, no common type to narrow to); see the file's own comment. |
| `middleware/authMiddleware.js` | `middleware/authMiddleware.ts` | 1 | `delete req.user.password` changed to a destructure-and-omit (`const { password, ...rest } = user`) — `delete` doesn't type-check against a required Prisma field. Same runtime result (`req.user` has no `password`), different mechanism. Added `types/express.d.ts` augmenting `Express.Request.user` as `Omit<PrismaUser, 'password'>`. |
| `middleware/roleMiddleware.js` | `middleware/roleMiddleware.ts` | 1 | `req.user!.role` — non-null assertion preserves the original's exact runtime behavior (throws if `protect` wasn't run first, same as the old plain `req.user.role` would); every real route already chains `protect` before this, per authRoutes.js/projectRoutes.js/etc. |
| `middleware/validate.js` | `middleware/validate.ts` | 1 | Mechanical — every export is an Express middleware, typed via `(req: Request, res: Response, next: NextFunction)`. |
| `middleware/upload.js` | `middleware/upload.ts` | 1 | Added `types/multer-storage-cloudinary.d.ts` — that package ships no types of its own and has no `@types` package. |
| `middleware/attachmentUpload.js` | `middleware/attachmentUpload.ts` | 1 | |
| `utils/access.js` | `utils/access.ts` | 1 | `ROLE_RANK` explicitly typed `Record<string, number>` (role is a plain string column, not a Prisma enum — see user.prisma) rather than letting TS infer a literal-keyed object. |
| `utils/notifications.js` | `utils/notifications.ts` | 1 | Added a `NotificationPayload` interface covering the `NotificationType` enum + optional FK fields, replacing the previously-untyped `payload` param. |
| `services/statusSync.service.js` | `services/statusSync.service.ts` | 2 | `typeForDepth` return typed against the generated `ProjectItemType` enum. |
| `queues/userDeactivationQueue.js` | `queues/userDeactivationQueue.ts` | 2 | Added an exported `DeactivationJobData` interface (shared with the worker below) and typed the BullMQ `Queue<DeactivationJobData>` generic. |
| `jobs/attachmentSweeper.js` | `jobs/attachmentSweeper.ts` | 2 | |
| `workers/userDeactivationWorker.js` | `workers/userDeactivationWorker.ts` | 2 | Imports `DeactivationJobData` from `queues/userDeactivationQueue.ts` rather than redefining it; `Worker<DeactivationJobData>` typed accordingly. |
| `socket.js` | `socket.ts` | 2 | Added a `ClientToServerEvents` interface for every inbound `socket.on(...)` handler (payloads now typed instead of implicit `any`) — per migration.md's own flagged friction point. Outbound `emitToUser`/`ServerToClientEvents` stays a loose index signature since it's called with varying event names from controllers not yet migrated (Phase 3). Custom `socket.userId` property handled via a local `AppSocket` intersection type + narrow casts at the two point-of-use sites, rather than migrating every call site to socket.io's built-in `socket.data` mechanism (out of scope — a behavior-neutral rename across the whole file, not a typing change). `callType`/`callStatus`/message `type` typed against the generated `CallType`/`CallStatus`/`MessageType` enums (caught by `tsc` on first pass). |
| `controllers/authController.js` | `controllers/authController.ts` | 3 | `toUserShape` given an explicit `UserForShape` param type; `COOKIE_OPTIONS` typed as `CookieOptions` so the `sameSite` ternary narrows to the literal union instead of widening to `string`. `existing.profileImage` null-checked (Prisma's `findUnique` return is `T \| null`) — a real null-safety fix, not just typing. |
| `controllers/projectRoleController.js` | `controllers/projectRoleController.ts` | 3 | Mechanical. |
| `controllers/organizationController.js` | `controllers/organizationController.ts` | 3 | `req.params.token` cast to `string` (Express 5's params type is `string \| string[]`) — needed to get Prisma's `findUnique` to resolve its properly-`include`-typed overload rather than falling back to the bare model type. `Prisma.XUncheckedUpdateInput` used (not the "checked" variant) so `updatedById` stays a plain scalar field, matching the original object shape exactly. |
| `controllers/userController.js` | `controllers/userController.ts` | 3 | Same `Prisma.UserUncheckedUpdateInput` choice as above, for the same reason (`data.managerId`/`data.teamLeadId` stay plain scalar assignments instead of becoming `connect`/`disconnect` relation syntax). |
| `controllers/departmentController.js` | `controllers/departmentController.ts` | 3 | `withCounts` made generic (`<T extends {_count: {...}}>`) so the flattened return type still reflects each call site's actual `include` shape. |
| `controllers/categoryController.js` | `controllers/categoryController.ts` | 3 | Same generic `withCounts` pattern as Department. |
| `controllers/tagController.js` | `controllers/tagController.ts` | 3 | Mechanical. |
| `controllers/projectController.js` | `controllers/projectController.ts` | 3 | `canAccessProject`/`canManageProjectSettings`/`canEditProject`/`canApproveDraft` given real parameter interfaces (`ProjectForAccess`/`ProjectForEdit`/`ProjectForSettings`) instead of implicit `any` — these are imported and reused by every other project-related controller, so getting their shapes right here mattered most in this phase. `shapeProject` made generic like `withCounts`. |
| `controllers/projectItemController.js` | `controllers/projectItemController.ts` | 3 | Largest file in the migration (962 lines). `duplicateSubtree`'s `tx` param typed as `Prisma.TransactionClient`; the recursive-copy and tree-walk helpers (`getDescendantIds`/`getMaxDescendantDepth`/`shiftDescendantDepths`) fully typed. Comment/item `mentions` JSON field needed a `validMentions as unknown as Prisma.InputJsonValue` cast — Prisma's JSON input type doesn't structurally accept a nominal interface array directly. |
| `controllers/projectMemberController.js` | `controllers/projectMemberController.ts` | 3 | Mechanical. |
| `controllers/projectCommentController.js` | `controllers/projectCommentController.ts` | 3 | Same `mentions` JSON cast as projectItemController. |
| `controllers/attachmentController.js` | `controllers/attachmentController.ts` | 3 | `getAttachmentDownloadInfo`/`permanentlyDeleteAttachment` typed against Prisma's generated `Attachment` type directly (no custom interface needed). |
| `controllers/taskController.js` | `controllers/taskController.ts` | 3 | Mechanical, following the same `Prisma.TaskWhereInput`/`Prisma.TaskUncheckedUpdateInput` pattern established earlier in this phase. |
| `controllers/notificationController.js` | `controllers/notificationController.ts` | 3 | Mechanical. |
| `controllers/chatController.js` | `controllers/chatController.ts` | 3 | `getContacts`'s per-contact stats given a `ContactStats` interface; ICE server config given an `IceServer` union type (mixed STUN/TURN shapes). |
| `controllers/dashboardController.js` | `controllers/dashboardController.ts` | 3 | `DashboardResult` interface added so `result.departmentBreakdown`/`result.teamBreakdown` can be attached conditionally by role without widening the whole object to `any`. |
| `routes/authRoutes.js` | `routes/authRoutes.ts` | 4 | Mechanical — pure `Router()` wiring, zero logic changes. |
| `routes/userRoutes.js` | `routes/userRoutes.ts` | 4 | Mechanical. |
| `routes/organizationRoutes.js` | `routes/organizationRoutes.ts` | 4 | Mechanical. |
| `routes/departmentRoutes.js` | `routes/departmentRoutes.ts` | 4 | Mechanical. |
| `routes/categoryRoutes.js` | `routes/categoryRoutes.ts` | 4 | Mechanical. |
| `routes/tagRoutes.js` | `routes/tagRoutes.ts` | 4 | Mechanical. |
| `routes/projectRoleRoutes.js` | `routes/projectRoleRoutes.ts` | 4 | Mechanical. |
| `routes/projectRoutes.js` | `routes/projectRoutes.ts` | 4 | Mechanical (largest route file, 275 lines, but pure wiring). |
| `routes/taskRoutes.js` | `routes/taskRoutes.ts` | 4 | Mechanical. |
| `routes/notificationRoutes.js` | `routes/notificationRoutes.ts` | 4 | Mechanical. |
| `routes/chatRoutes.js` | `routes/chatRoutes.ts` | 4 | Mechanical. |
| `routes/dashboardRoutes.js` | `routes/dashboardRoutes.ts` | 4 | Mechanical. |
| `index.js` | `index.ts` | 5 | `package.json`'s `start` script switched from `tsx index.js` to `node dist/index.js` (compiled output) now that every source file is `.ts` — see migration.md's Definition of Done; `npm run build` verified clean, and `node dist/index.js` boot-tested identically to the `tsx`/pre-migration behavior. |
| `scripts/migrateTaskStatus.js` | `scripts/migrateTaskStatus.ts` | 5 | Standalone one-off script (top-level `await`, unchanged otherwise). |
| `models/Counter.js` | `models/Counter.ts` | — | Originally left out of scope (dead legacy Mongoose model); migrated afterward on request. `CounterDocument extends Document<string>` — mongoose's `Document` defaults `_id` to `ObjectId`, but this schema's `_id` is a plain string counter name, so it needs the generic override. `Counter.findOneAndUpdate(...)` returns `CounterDocument \| null` per mongoose's types (they don't know `upsert: true` guarantees a result), so `utils/counter.ts` added a `!` there. With this file gone, `tsconfig.json`'s `allowJs`/`checkJs` were removed entirely (nothing `.js` left to import) and `include` narrowed to `**/*.ts` only. |
