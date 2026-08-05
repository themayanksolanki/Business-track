import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import { validateStatusForm, validateStatusFormId } from '../middleware/validate.js';
import { getStatusForms, createStatusForm, updateStatusForm, deleteStatusForm } from '../controllers/statusFormController.js';

const router = Router();

// Not Admin-gated (unlike create/update/delete below) — a Project's owner
// needs to list available templates to pick one on the Status Report tab
// (projectController.ts/statusReportController.ts), and this is read-only,
// already org-scoped in the query below.
router.get('/', protect, getStatusForms);
router.post('/', protect, allowRoles('Admin'), validateStatusForm, createStatusForm);
router.put('/:id', protect, allowRoles('Admin'), validateStatusFormId, validateStatusForm, updateStatusForm);
router.delete('/:id', protect, allowRoles('Admin'), validateStatusFormId, deleteStatusForm);

export default router;
