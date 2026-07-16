import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import {
  validateDepartment,
  validateDepartmentId,
} from '../middleware/validate.js';
import {
  getDepartments,
  createDepartment,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
} from '../controllers/departmentController.js';

const router = Router();

router.get('/', protect, getDepartments);
router.post('/', protect, allowRoles('Admin', 'Manager'), validateDepartment, createDepartment);
router.get('/:id', protect, validateDepartmentId, getDepartmentById);
router.put(
  '/:id',
  protect,
  allowRoles('Admin', 'Manager'),
  validateDepartmentId,
  validateDepartment,
  updateDepartment
);
router.delete('/:id', protect, allowRoles('Admin', 'Manager'), validateDepartmentId, deleteDepartment);

export default router;
