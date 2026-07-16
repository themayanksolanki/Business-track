import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import {
  getAllUsers,
  getTeamLeads,
  getTeamMembers,
  getPendingUsers,
  activateUser,
  deactivateUser,
  updateUserPassword,
  updateUserDepartments,
} from '../controllers/userController.js';
import { validateObjectId, validateDepartmentIds } from '../middleware/validate.js';

const router = Router();

router.get('/', protect, allowRoles('Admin', 'Manager'), getAllUsers);
router.get('/team-leads', protect, allowRoles('Admin', 'Manager'), getTeamLeads);
router.get('/team-members', protect, allowRoles('Admin', 'Team Lead'), getTeamMembers);
router.get('/pending', protect, allowRoles('Admin', 'Manager', 'Team Lead'), getPendingUsers);
router.patch(
  '/:id/activate',
  protect,
  allowRoles('Admin', 'Manager', 'Team Lead'),
  validateObjectId,
  activateUser
);
router.patch(
  '/:id/deactivate',
  protect,
  allowRoles('Admin', 'Manager', 'Team Lead'),
  validateObjectId,
  deactivateUser
);
router.patch(
  '/:id/password',
  protect,
  allowRoles('Admin', 'Manager', 'Team Lead'),
  validateObjectId,
  updateUserPassword
);
router.patch(
  '/:id/departments',
  protect,
  allowRoles('Admin', 'Manager'),
  validateObjectId,
  validateDepartmentIds,
  updateUserDepartments
);

export default router;
