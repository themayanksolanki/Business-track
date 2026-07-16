import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { attachmentUpload } from '../middleware/attachmentUpload.js';
import {
  validateProject,
  validateProjectItem,
  validateReorder,
  validateMove,
  validateComment,
  validateProjectId,
  validateItemId,
  validateCommentId,
  validateAttachmentId,
} from '../middleware/validate.js';
import {
  getProjects,
  createProject,
  getProjectById,
  updateProject,
  deleteProject,
} from '../controllers/projectController.js';
import {
  getItems,
  getItemsSummary,
  createItem,
  getItemById,
  updateItem,
  deleteItem,
  reorderItems,
  moveItem,
} from '../controllers/projectItemController.js';
import {
  getComments,
  createComment,
  deleteComment,
} from '../controllers/projectCommentController.js';
import {
  getItemAttachments,
  uploadItemAttachment,
  downloadItemAttachment,
  deleteItemAttachment,
} from '../controllers/attachmentController.js';

const router = Router();

router.get('/', protect, getProjects);
router.post('/', protect, validateProject, createProject);
router.get('/:projectId', protect, validateProjectId, getProjectById);
router.put('/:projectId', protect, validateProjectId, validateProject, updateProject);
router.delete('/:projectId', protect, validateProjectId, deleteProject);

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
router.put(
  '/:projectId/items/:itemId',
  protect,
  validateProjectId,
  validateItemId,
  validateProjectItem,
  updateItem
);
router.delete('/:projectId/items/:itemId', protect, validateProjectId, validateItemId, deleteItem);

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

export default router;
