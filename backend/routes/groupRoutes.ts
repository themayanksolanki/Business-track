import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { groupAvatarUpload } from '../middleware/upload.js';
import {
  validateGroupId,
  validateGroup,
  validateAddGroupMembers,
  validateUpdateGroupMemberRole,
  validateMemberId,
} from '../middleware/validate.js';
import {
  createGroup,
  getGroups,
  getGroupById,
  updateGroup,
  uploadGroupAvatar,
  deleteGroup,
  getGroupMembers,
  getGroupMemberCandidates,
  addGroupMembers,
  updateGroupMemberRole,
  removeGroupMember,
  leaveGroup,
} from '../controllers/groupController.js';
import { getGroupMessages } from '../controllers/groupMessageController.js';

const router = Router();

router.get('/', protect, getGroups);
router.post('/', protect, validateGroup, createGroup);

// Must be registered before '/:groupId' — org-wide candidate search for the
// "create group" flow, before any group exists to scope against.
router.get('/candidates', protect, getGroupMemberCandidates);

router.get('/:groupId', protect, validateGroupId, getGroupById);
router.patch('/:groupId', protect, validateGroupId, validateGroup, updateGroup);
router.patch('/:groupId/avatar', protect, validateGroupId, groupAvatarUpload, uploadGroupAvatar);
router.delete('/:groupId', protect, validateGroupId, deleteGroup);

router.get('/:groupId/members', protect, validateGroupId, getGroupMembers);
router.get('/:groupId/members/candidates', protect, validateGroupId, getGroupMemberCandidates);
router.post('/:groupId/members', protect, validateGroupId, validateAddGroupMembers, addGroupMembers);
router.patch(
  '/:groupId/members/:memberId',
  protect,
  validateGroupId,
  validateMemberId,
  validateUpdateGroupMemberRole,
  updateGroupMemberRole
);
router.delete('/:groupId/members/:memberId', protect, validateGroupId, validateMemberId, removeGroupMember);

router.post('/:groupId/leave', protect, validateGroupId, leaveGroup);

router.get('/:groupId/messages', protect, validateGroupId, getGroupMessages);

export default router;
