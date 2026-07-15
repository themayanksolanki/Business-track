import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import { validateTask, validateReassign, validateObjectId } from '../middleware/validate.js';
import { attachmentUpload } from '../middleware/attachmentUpload.js';
import {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  reassignTask,
  getSubtasks,
} from '../controllers/taskController.js';
import {
  getAttachments,
  uploadAttachment,
  downloadAttachment,
} from '../controllers/attachmentController.js';

const router = Router();

router.get('/', protect, getTasks);
router.post('/', protect, validateTask, createTask);
router.get('/:id/subtasks', protect, validateObjectId, getSubtasks);
router.get('/:id/attachments', protect, validateObjectId, getAttachments);
router.post('/:id/attachments', protect, validateObjectId, attachmentUpload, uploadAttachment);
router.get('/:id/attachments/:attachmentId/download', protect, validateObjectId, downloadAttachment);
router.get('/:id', protect, validateObjectId, getTaskById);
router.put('/:id', protect, validateObjectId, validateTask, updateTask);
router.delete('/:id', protect, validateObjectId, deleteTask);
router.patch('/:id/reassign', protect, validateObjectId, allowRoles('Manager'), validateReassign, reassignTask);

export default router;
