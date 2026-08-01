import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import { validateStatusForm, validateStatusFormId } from '../middleware/validate.js';
import { getStatusForms, createStatusForm, updateStatusForm, deleteStatusForm } from '../controllers/statusFormController.js';

const router = Router();

router.get('/', protect, allowRoles('Admin'), getStatusForms);
router.post('/', protect, allowRoles('Admin'), validateStatusForm, createStatusForm);
router.put('/:id', protect, allowRoles('Admin'), validateStatusFormId, validateStatusForm, updateStatusForm);
router.delete('/:id', protect, allowRoles('Admin'), validateStatusFormId, deleteStatusForm);

export default router;
