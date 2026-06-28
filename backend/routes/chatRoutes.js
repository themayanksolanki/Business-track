import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { getContacts, getMessages, uploadChatImage } from '../controllers/chatController.js';
import { chatImageUpload } from '../middleware/upload.js';

const router = Router();

router.get('/contacts', protect, getContacts);
router.get('/messages/:userId', protect, getMessages);
router.post('/upload', protect, chatImageUpload, uploadChatImage);

export default router;
