import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import {
  validateMetric,
  validateMetricId,
  validateMetricReorder,
  validateTrackingParams,
  validateTrackingDiff,
  validateMetricLink,
  validateSubMetricId,
  validateAddMetricMember,
  validateUpdateMetricMemberRole,
  validateMetricMemberId,
} from '../middleware/validate.js';
import {
  getMetrics,
  createMetric,
  getMetricById,
  updateMetric,
  getMetricTiles,
  reorderMetrics,
} from '../controllers/metricController.js';
import { getPeriodData, savePeriodDiff } from '../controllers/metricTrackingController.js';
import { getSubMetrics, addSubMetric, removeSubMetric } from '../controllers/metricLinkController.js';
import {
  getMembers,
  getMemberCandidates,
  addMember,
  updateMemberRole,
  removeMember,
} from '../controllers/metricMemberController.js';
import {
  getMetricAttachments,
  uploadMetricAttachment,
  addMetricAttachmentLink,
  downloadMetricAttachment,
  deleteMetricAttachment,
  undoMetricAttachment,
} from '../controllers/attachmentController.js';
import { attachmentUpload } from '../middleware/attachmentUpload.js';

const router = Router();

router.get('/', protect, getMetrics);
router.post('/', protect, validateMetric, createMetric);
// Both registered ahead of /:metricId so 'tiles'/'reorder' aren't captured as a metricId.
router.get('/tiles', protect, getMetricTiles);
router.patch('/reorder', protect, validateMetricReorder, reorderMetrics);
router.get('/:metricId', protect, validateMetricId, getMetricById);
router.put('/:metricId', protect, validateMetricId, validateMetric, updateMetric);

router.get('/:metricId/attachments', protect, validateMetricId, getMetricAttachments);
router.post('/:metricId/attachments', protect, validateMetricId, attachmentUpload, uploadMetricAttachment);
router.post('/:metricId/attachments/link', protect, validateMetricId, addMetricAttachmentLink);
router.get(
  '/:metricId/attachments/:attachmentId/download',
  protect,
  validateMetricId,
  downloadMetricAttachment
);
router.delete('/:metricId/attachments/:attachmentId', protect, validateMetricId, deleteMetricAttachment);
router.post(
  '/:metricId/attachments/:attachmentId/undo',
  protect,
  validateMetricId,
  undoMetricAttachment
);

router.get(
  '/:metricId/tracking/:frequency',
  protect,
  validateMetricId,
  validateTrackingParams,
  getPeriodData
);
router.put(
  '/:metricId/tracking/:frequency',
  protect,
  validateMetricId,
  validateTrackingParams,
  validateTrackingDiff,
  savePeriodDiff
);

router.get('/:metricId/links', protect, validateMetricId, getSubMetrics);
router.post('/:metricId/links', protect, validateMetricId, validateMetricLink, addSubMetric);
router.delete('/:metricId/links/:subMetricId', protect, validateMetricId, validateSubMetricId, removeSubMetric);

router.get('/:metricId/members', protect, validateMetricId, getMembers);
router.get('/:metricId/members/candidates', protect, validateMetricId, getMemberCandidates);
router.post('/:metricId/members', protect, validateMetricId, validateAddMetricMember, addMember);
router.patch(
  '/:metricId/members/:memberId',
  protect,
  validateMetricId,
  validateMetricMemberId,
  validateUpdateMetricMemberRole,
  updateMemberRole
);
router.delete('/:metricId/members/:memberId', protect, validateMetricId, validateMetricMemberId, removeMember);

export default router;
