import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import {
  getContacts, getMessages, uploadChatImage, getIceServers, getCallHistory,
  clearChat, toggleBlock, toggleMute,
} from '../controllers/chatController.js';
import { chatImageUpload } from '../middleware/upload.js';

const router = Router();

router.get('/ice-servers', protect, getIceServers);
router.get('/contacts', protect, getContacts);
router.get('/messages/:userId', protect, getMessages);
router.get('/calls',   protect, getCallHistory);
router.post('/upload', protect, chatImageUpload, uploadChatImage);
router.delete('/clear/:userId', protect, clearChat);
router.post('/block/:userId', protect, toggleBlock);
router.post('/mute/:userId', protect, toggleMute);

export default router;
