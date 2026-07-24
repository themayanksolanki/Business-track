import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import { validateMetric, validateMetricId, validateTrackingParams, validateTrackingDiff, } from '../middleware/validate.js';
import { getMetrics, createMetric, getMetricById, updateMetric } from '../controllers/metricController.js';
import { getPeriodData, savePeriodDiff } from '../controllers/metricTrackingController.js';
const router = Router();
router.get('/', protect, getMetrics);
router.post('/', protect, validateMetric, createMetric);
router.get('/:metricId', protect, validateMetricId, getMetricById);
router.put('/:metricId', protect, validateMetricId, validateMetric, updateMetric);
router.get('/:metricId/tracking/:frequency', protect, validateMetricId, validateTrackingParams, getPeriodData);
router.put('/:metricId/tracking/:frequency', protect, validateMetricId, validateTrackingParams, validateTrackingDiff, savePeriodDiff);
export default router;
//# sourceMappingURL=metricRoutes.js.map