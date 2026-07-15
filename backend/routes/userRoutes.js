import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import {
  getAllUsers,
  getTeamLeads,
  getTeamMembers,
  getPendingUsers,
  activateUser,
  updateUserPassword,
} from '../controllers/userController.js';
import { validateObjectId } from '../middleware/validate.js';

const router = Router();

router.get('/', protect, allowRoles('Manager'), getAllUsers);
router.get('/team-leads', protect, allowRoles('Manager'), getTeamLeads);
router.get('/team-members', protect, allowRoles('Team Lead'), getTeamMembers);
router.get('/pending', protect, allowRoles('Manager', 'Team Lead'), getPendingUsers);
router.patch('/:id/activate', protect, allowRoles('Manager', 'Team Lead'), validateObjectId, activateUser);
router.patch('/:id/password', protect, allowRoles('Manager', 'Team Lead'), validateObjectId, updateUserPassword);

export default router;
