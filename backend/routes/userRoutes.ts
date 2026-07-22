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
  updateUser,
  getReassignableWork,
} from '../controllers/userController.js';
import { validateObjectId, validateDepartmentIds, validateUpdateUser } from '../middleware/validate.js';

const router = Router();

router.get('/', protect, getAllUsers);
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
router.get(
  '/:id/reassignable-work',
  protect,
  allowRoles('Admin', 'Manager'),
  validateObjectId,
  getReassignableWork
);
router.patch(
  '/:id',
  protect,
  allowRoles('Admin', 'Manager'),
  validateObjectId,
  validateUpdateUser,
  updateUser
);

export default router;
