import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { attachmentUpload } from '../middleware/attachmentUpload.js';
import {
  validateProject,
  validateProjectItem,
  validateReorder,
  validateMove,
  validateMoveToParent,
  validateBulkMoveToParent,
  validateComment,
  validateProjectId,
  validateItemId,
  validateCommentId,
  validateAttachmentId,
  validateAttachmentLink,
  validateAddMember,
  validateUpdateMemberRole,
  validateMemberId,
  validateProjectDetailsLayout,
} from '../middleware/validate.js';
import {
  getProjects,
  createProject,
  getProjectById,
  getSharedProject,
  updateProject,
  updateProjectDetailsLayout,
  deleteProject,
  uploadProjectPlan,
  downloadProjectPlan,
  removeProjectPlan,
} from '../controllers/projectController.js';
import {
  getItems,
  getItemsSummary,
  getSharedProjectItems,
  createItem,
  getItemById,
  updateItem,
  deleteItem,
  duplicateItem,
  reorderItems,
  moveItem,
  moveItemToParent,
  bulkMoveItemsToParent,
} from '../controllers/projectItemController.js';
import {
  getComments,
  createComment,
  updateComment,
  deleteComment,
} from '../controllers/projectCommentController.js';
import {
  getMembers,
  getMemberCandidates,
  addMember,
  updateMemberRole,
  removeMember,
} from '../controllers/projectMemberController.js';
import {
  getItemAttachments,
  uploadItemAttachment,
  addItemAttachmentLink,
  downloadItemAttachment,
  deleteItemAttachment,
  undoItemAttachment,
  getProjectAttachments,
  uploadProjectAttachment,
  downloadProjectAttachment,
  deleteProjectAttachment,
} from '../controllers/attachmentController.js';

const router = Router();

router.get('/', protect, getProjects);
router.post('/', protect, validateProject, createProject);
router.get('/:projectId', protect, validateProjectId, getProjectById);

// Shareable "Copy Project Link" surface — resolved by org + per-org sequence
// number (never the raw numeric id), deliberately read-only (no write routes
// live under /shared) so any logged-in user, regardless of organization or
// membership, can view a project they were given the link to. See
// getSharedProject's own comment in projectController.js for why this is
// kept separate from the normal /:projectId surface instead of relaxing it.
router.get('/shared/:organizationId/:sequenceId', protect, getSharedProject);
router.get('/shared/:organizationId/:sequenceId/items', protect, getSharedProjectItems);
router.put('/:projectId', protect, validateProjectId, validateProject, updateProject);
router.patch(
  '/:projectId/details-layout',
  protect,
  validateProjectId,
  validateProjectDetailsLayout,
  updateProjectDetailsLayout
);
router.delete('/:projectId', protect, validateProjectId, deleteProject);

router.get('/:projectId/attachments', protect, validateProjectId, getProjectAttachments);
router.post(
  '/:projectId/attachments',
  protect,
  validateProjectId,
  attachmentUpload,
  uploadProjectAttachment
);
router.get(
  '/:projectId/attachments/:attachmentId/download',
  protect,
  validateProjectId,
  validateAttachmentId,
  downloadProjectAttachment
);
router.delete(
  '/:projectId/attachments/:attachmentId',
  protect,
  validateProjectId,
  validateAttachmentId,
  deleteProjectAttachment
);

router.put('/:projectId/plan', protect, validateProjectId, attachmentUpload, uploadProjectPlan);
router.get('/:projectId/plan/download', protect, validateProjectId, downloadProjectPlan);
router.delete('/:projectId/plan', protect, validateProjectId, removeProjectPlan);

router.get('/:projectId/members', protect, validateProjectId, getMembers);
router.get('/:projectId/members/candidates', protect, validateProjectId, getMemberCandidates);
router.post('/:projectId/members', protect, validateProjectId, validateAddMember, addMember);
router.patch(
  '/:projectId/members/:memberId',
  protect,
  validateProjectId,
  validateMemberId,
  validateUpdateMemberRole,
  updateMemberRole
);
router.delete('/:projectId/members/:memberId', protect, validateProjectId, validateMemberId, removeMember);

router.get('/:projectId/items', protect, validateProjectId, getItems);
router.post('/:projectId/items', protect, validateProjectId, validateProjectItem, createItem);
router.get('/:projectId/items/summary', protect, validateProjectId, getItemsSummary);
router.patch('/:projectId/items/reorder', protect, validateProjectId, validateReorder, reorderItems);
router.get('/:projectId/items/:itemId', protect, validateProjectId, validateItemId, getItemById);
router.patch(
  '/:projectId/items/:itemId/move',
  protect,
  validateProjectId,
  validateItemId,
  validateMove,
  moveItem
);
router.patch(
  '/:projectId/items/:itemId/move-to',
  protect,
  validateProjectId,
  validateItemId,
  validateMoveToParent,
  moveItemToParent
);
router.patch(
  '/:projectId/items/bulk-move-to',
  protect,
  validateProjectId,
  validateBulkMoveToParent,
  bulkMoveItemsToParent
);
router.put(
  '/:projectId/items/:itemId',
  protect,
  validateProjectId,
  validateItemId,
  validateProjectItem,
  updateItem
);
router.delete('/:projectId/items/:itemId', protect, validateProjectId, validateItemId, deleteItem);
router.post(
  '/:projectId/items/:itemId/duplicate',
  protect,
  validateProjectId,
  validateItemId,
  duplicateItem
);

router.get(
  '/:projectId/items/:itemId/comments',
  protect,
  validateProjectId,
  validateItemId,
  getComments
);
router.post(
  '/:projectId/items/:itemId/comments',
  protect,
  validateProjectId,
  validateItemId,
  validateComment,
  createComment
);
router.patch(
  '/:projectId/items/:itemId/comments/:commentId',
  protect,
  validateProjectId,
  validateItemId,
  validateCommentId,
  validateComment,
  updateComment
);
router.delete(
  '/:projectId/items/:itemId/comments/:commentId',
  protect,
  validateProjectId,
  validateItemId,
  validateCommentId,
  deleteComment
);

router.get(
  '/:projectId/items/:itemId/attachments',
  protect,
  validateProjectId,
  validateItemId,
  getItemAttachments
);
router.post(
  '/:projectId/items/:itemId/attachments',
  protect,
  validateProjectId,
  validateItemId,
  attachmentUpload,
  uploadItemAttachment
);
router.post(
  '/:projectId/items/:itemId/attachments/link',
  protect,
  validateProjectId,
  validateItemId,
  validateAttachmentLink,
  addItemAttachmentLink
);
router.get(
  '/:projectId/items/:itemId/attachments/:attachmentId/download',
  protect,
  validateProjectId,
  validateItemId,
  validateAttachmentId,
  downloadItemAttachment
);
router.delete(
  '/:projectId/items/:itemId/attachments/:attachmentId',
  protect,
  validateProjectId,
  validateItemId,
  validateAttachmentId,
  deleteItemAttachment
);
router.post(
  '/:projectId/items/:itemId/attachments/:attachmentId/undo',
  protect,
  validateProjectId,
  validateItemId,
  validateAttachmentId,
  undoItemAttachment
);

export default router;
