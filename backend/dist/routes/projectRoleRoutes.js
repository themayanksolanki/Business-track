import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import { validateProjectRole, validateProjectRoleId, validateProjectRoleReorder, } from '../middleware/validate.js';
import { getProjectRoles, createProjectRole, updateProjectRole, deleteProjectRole, reorderProjectRoles, } from '../controllers/projectRoleController.js';
const router = Router();
router.get('/', protect, getProjectRoles);
router.post('/', protect, validateProjectRole, createProjectRole);
router.patch('/reorder', protect, allowRoles('Admin', 'Manager'), validateProjectRoleReorder, reorderProjectRoles);
router.put('/:id', protect, allowRoles('Admin', 'Manager'), validateProjectRoleId, validateProjectRole, updateProjectRole);
router.delete('/:id', protect, allowRoles('Admin', 'Manager'), validateProjectRoleId, deleteProjectRole);
export default router;
//# sourceMappingURL=projectRoleRoutes.js.map