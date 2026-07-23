import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { validateObjectId } from '../middleware/validate.js';
import { getNotifications, markAsRead, markAllAsRead } from '../controllers/notificationController.js';
const router = Router();
router.get('/', protect, getNotifications);
router.patch('/read-all', protect, markAllAsRead);
router.patch('/:id/read', protect, validateObjectId, markAsRead);
export default router;
//# sourceMappingURL=notificationRoutes.js.map