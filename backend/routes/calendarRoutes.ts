import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { validateCalendar, validateCalendarId } from '../middleware/validate.js';
import {
  getCalendars,
  createCalendar,
  updateCalendar,
  deleteCalendar,
} from '../controllers/calendarController.js';

const router = Router();

// No allowRoles gate — a Calendar is personal (ownerId-scoped), so
// authorization is the per-row owner-or-Admin check inside the controller
// (canAccessCalendar), not a role gate like calendarCategoryRoutes.ts.
router.get('/', protect, getCalendars);
router.post('/', protect, validateCalendar, createCalendar);
router.put('/:id', protect, validateCalendarId, validateCalendar, updateCalendar);
router.delete('/:id', protect, validateCalendarId, deleteCalendar);

export default router;
