import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import { validateTask, validateReassign, validateObjectId } from '../middleware/validate.js';
import {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  reassignTask,
} from '../controllers/taskController.js';

const router = Router();

router.get('/', protect, getTasks);
router.post('/', protect, validateTask, createTask);
router.get('/:id', protect, validateObjectId, getTaskById);
router.put('/:id', protect, validateObjectId, validateTask, updateTask);
router.delete('/:id', protect, validateObjectId, deleteTask);
router.patch('/:id/reassign', protect, validateObjectId, allowRoles('Manager'), validateReassign, reassignTask);

export default router;
