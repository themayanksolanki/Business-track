import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { validateEvent, validateEventId, validateOccurrenceParams, validateAttachmentId, validateAttachmentLink, } from '../middleware/validate.js';
import { attachmentUpload } from '../middleware/attachmentUpload.js';
import { getEvents, createEvent, getEventById, updateEvent, deleteEvent, getOccurrence, updateOccurrence, skipOccurrence, } from '../controllers/eventController.js';
import { getEventAttachments, uploadEventAttachment, addEventAttachmentLink, downloadEventAttachment, deleteEventAttachment, undoEventAttachment, } from '../controllers/attachmentController.js';
const router = Router();
router.get('/', protect, getEvents);
router.post('/', protect, validateEvent, createEvent);
router.get('/:eventId', protect, validateEventId, getEventById);
router.put('/:eventId', protect, validateEventId, validateEvent, updateEvent);
router.delete('/:eventId', protect, validateEventId, deleteEvent);
// Attachments — file upload or a pasted link, with a 10s undo-able pending
// delete, mirroring the ProjectItem attachment routes below.
router.get('/:eventId/attachments', protect, validateEventId, getEventAttachments);
router.post('/:eventId/attachments', protect, validateEventId, attachmentUpload, uploadEventAttachment);
router.post('/:eventId/attachments/link', protect, validateEventId, validateAttachmentLink, addEventAttachmentLink);
router.get('/:eventId/attachments/:attachmentId/download', protect, validateEventId, validateAttachmentId, downloadEventAttachment);
router.delete('/:eventId/attachments/:attachmentId', protect, validateEventId, validateAttachmentId, deleteEventAttachment);
router.post('/:eventId/attachments/:attachmentId/undo', protect, validateEventId, validateAttachmentId, undoEventAttachment);
// Per-occurrence exceptions to a recurring event (see EventException) —
// :originalStart identifies which generated slot the request targets, not
// an id. PUT edits just this occurrence, DELETE skips just this occurrence;
// the plain /:eventId routes above remain "the whole series."
router.get('/:eventId/occurrences/:originalStart', protect, validateOccurrenceParams, getOccurrence);
router.put('/:eventId/occurrences/:originalStart', protect, validateOccurrenceParams, updateOccurrence);
router.delete('/:eventId/occurrences/:originalStart', protect, validateOccurrenceParams, skipOccurrence);
export default router;
//# sourceMappingURL=eventRoutes.js.map