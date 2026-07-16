import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import { validateInvite, validateActivateInvite, validateObjectId } from '../middleware/validate.js';
import {
  getMyOrganization,
  updateOrganization,
  getAdmins,
  createInvite,
  getInvites,
  revokeInvite,
  activateInvite,
} from '../controllers/organizationController.js';

const router = Router();

router.get('/me', protect, getMyOrganization);
router.patch('/me', protect, allowRoles('Admin'), updateOrganization);
router.get('/admins', protect, allowRoles('Admin'), getAdmins);
router.post('/invites', protect, allowRoles('Admin', 'Manager', 'Team Lead'), validateInvite, createInvite);
router.get('/invites', protect, allowRoles('Admin', 'Manager', 'Team Lead'), getInvites);
router.delete(
  '/invites/:id',
  protect,
  allowRoles('Admin', 'Manager', 'Team Lead'),
  validateObjectId,
  revokeInvite
);
router.post(
  '/invites/:id/activate',
  protect,
  allowRoles('Admin', 'Manager', 'Team Lead'),
  validateObjectId,
  validateActivateInvite,
  activateInvite
);

export default router;
