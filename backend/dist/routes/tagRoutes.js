import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import { validateTag, validateTagId } from '../middleware/validate.js';
import { getTags, createTag, updateTag, deleteTag } from '../controllers/tagController.js';
const router = Router();
router.get('/', protect, getTags);
router.post('/', protect, validateTag, createTag);
router.put('/:id', protect, allowRoles('Admin', 'Manager'), validateTagId, validateTag, updateTag);
router.delete('/:id', protect, allowRoles('Admin', 'Manager'), validateTagId, deleteTag);
export default router;
//# sourceMappingURL=tagRoutes.js.map