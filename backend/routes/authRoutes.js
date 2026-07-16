import { Router } from 'express';
import { register, registerOrganization, login, getMe, refresh, logout, updateAvatar, removeAvatar, forgotPassword, resetPassword } from '../controllers/authController.js';
import protect from '../middleware/authMiddleware.js';
import { avatarUpload } from '../middleware/upload.js';
import { validateRegister, validateOrgRegister, validateLogin } from '../middleware/validate.js';

const router = Router();

router.post('/register', validateRegister, register);
router.post('/register-organization', validateOrgRegister, registerOrganization);
router.post('/login', validateLogin, login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', protect, getMe);
router.patch('/me/avatar', protect, avatarUpload, updateAvatar);
router.delete('/me/avatar', protect, removeAvatar);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
