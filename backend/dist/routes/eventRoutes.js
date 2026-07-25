import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { validateEvent, validateEventId, validateOccurrenceParams } from '../middleware/validate.js';
import { getEvents, createEvent, getEventById, updateEvent, deleteEvent, getOccurrence, updateOccurrence, skipOccurrence, } from '../controllers/eventController.js';
const router = Router();
router.get('/', protect, getEvents);
router.post('/', protect, validateEvent, createEvent);
router.get('/:eventId', protect, validateEventId, getEventById);
router.put('/:eventId', protect, validateEventId, validateEvent, updateEvent);
router.delete('/:eventId', protect, validateEventId, deleteEvent);
// Per-occurrence exceptions to a recurring event (see EventException) —
// :originalStart identifies which generated slot the request targets, not
// an id. PUT edits just this occurrence, DELETE skips just this occurrence;
// the plain /:eventId routes above remain "the whole series."
router.get('/:eventId/occurrences/:originalStart', protect, validateOccurrenceParams, getOccurrence);
router.put('/:eventId/occurrences/:originalStart', protect, validateOccurrenceParams, updateOccurrence);
router.delete('/:eventId/occurrences/:originalStart', protect, validateOccurrenceParams, skipOccurrence);
export default router;
//# sourceMappingURL=eventRoutes.js.map