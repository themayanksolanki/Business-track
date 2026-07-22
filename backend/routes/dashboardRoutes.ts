import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { getDashboardStats } from '../controllers/dashboardController.js';

const router = Router();

router.get('/stats', protect, getDashboardStats);

export default router;
