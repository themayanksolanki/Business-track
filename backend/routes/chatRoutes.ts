import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import {
  getContacts, getMessages, uploadChatImage, getIceServers, getCallHistory,
  clearChat, toggleMute,
} from '../controllers/chatController.js';
import { chatImageUpload } from '../middleware/upload.js';

const router = Router();

// Deliberately NOT behind `protect` — Meet Hub's guest-join flow needs
// working ICE servers (incl. TURN) before/without ever logging in. Same
// static, non-user-specific config as the protected route below.
router.get('/public/ice-servers', getIceServers);
router.get('/ice-servers', protect, getIceServers);
router.get('/contacts', protect, getContacts);
router.get('/messages/:userId', protect, getMessages);
router.get('/calls',   protect, getCallHistory);
router.post('/upload', protect, chatImageUpload, uploadChatImage);
router.delete('/clear/:userId', protect, clearChat);
router.post('/mute/:userId', protect, toggleMute);

export default router;
