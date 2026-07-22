# .js files to delete on the other system

If the other machine already has an older checkout of this repo, unzipping/extracting on top
of it will **not** remove files that no longer exist in the new version. These 55 `.js` files
were replaced by `.ts` equivalents during this session's migration — delete them manually
(or do a clean extract into an empty directory instead of overwriting).

All paths are relative to `backend/`:

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
utils/access.js
utils/notifications.js
middleware/errorMiddleware.js
middleware/authMiddleware.js
middleware/roleMiddleware.js
middleware/validate.js
middleware/upload.js
middleware/attachmentUpload.js
services/statusSync.service.js
queues/userDeactivationQueue.js
jobs/attachmentSweeper.js
workers/userDeactivationWorker.js
socket.js
controllers/authController.js
controllers/projectRoleController.js
controllers/organizationController.js
controllers/userController.js
controllers/departmentController.js
controllers/categoryController.js
controllers/tagController.js
controllers/projectController.js
controllers/projectItemController.js
controllers/projectMemberController.js
controllers/projectCommentController.js
controllers/attachmentController.js
controllers/taskController.js
controllers/notificationController.js
controllers/chatController.js
controllers/dashboardController.js
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
index.js
scripts/migrateTaskStatus.js
models/Counter.js
```

No `.js` files remain anywhere in `backend/` after this migration — if any of the above (or
any other `.js` file) still exists after extracting, it's stale and safe to delete.
