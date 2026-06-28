import { Router } from 'express';
import { register, login, getMe, refresh, logout } from '../controllers/authController.js';
import protect from '../middleware/authMiddleware.js';
import { validateRegister, validateLogin } from '../middleware/validate.js';

const router = Router();

router.post('/register', validateRegister, register);
router.post('/login', validateLogin, login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', protect, getMe);

export default router;
