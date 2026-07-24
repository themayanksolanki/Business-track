import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import { validateCalendarCategory, validateCalendarCategoryId } from '../middleware/validate.js';
import {
  getCalendarCategories,
  createCalendarCategory,
  updateCalendarCategory,
  deleteCalendarCategory,
} from '../controllers/calendarCategoryController.js';

const router = Router();

// Open to any authenticated user (not role-gated) — mirrors tagRoutes.ts,
// since anyone creating an event may need a new category inline.
router.get('/', protect, getCalendarCategories);
router.post('/', protect, validateCalendarCategory, createCalendarCategory);
router.put('/:id', protect, allowRoles('Admin', 'Manager'), validateCalendarCategoryId, validateCalendarCategory, updateCalendarCategory);
router.delete('/:id', protect, allowRoles('Admin', 'Manager'), validateCalendarCategoryId, deleteCalendarCategory);

export default router;
