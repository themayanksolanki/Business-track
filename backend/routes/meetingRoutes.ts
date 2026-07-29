import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { validateObjectId } from '../middleware/validate.js';
import {
  createMeeting,
  getMeetingByRoomCode,
  joinMeeting,
  leaveMeeting,
  endMeeting,
  updateMeeting,
  cancelMeeting,
  getUpcomingMeetings,
  getMeetingHistory,
} from '../controllers/meetingController.js';

const router = Router();

// '/upcoming' must be registered before '/:roomCode' — both are bare GETs on
// this router, and Express matches route definitions in declaration order.
router.get('/upcoming', protect, getUpcomingMeetings);

router.post('/', protect, createMeeting);
router.get('/:roomCode', protect, getMeetingByRoomCode);
router.post('/:id/join', protect, validateObjectId, joinMeeting);
router.post('/:id/leave', protect, validateObjectId, leaveMeeting);
router.post('/:id/end', protect, validateObjectId, endMeeting);
router.patch('/:id', protect, validateObjectId, updateMeeting);
router.delete('/:id', protect, validateObjectId, cancelMeeting);
router.get('/:id/history', protect, validateObjectId, getMeetingHistory);

export default router;
