import { Router } from 'express';
import protect from '../middleware/authMiddleware.js';
import allowRoles from '../middleware/roleMiddleware.js';
import { validateCategory, validateCategoryId } from '../middleware/validate.js';
import {
  getCategories,
  createCategory,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from '../controllers/categoryController.js';

const router = Router();

router.get('/', protect, getCategories);
router.post('/', protect, allowRoles('Admin', 'Manager'), validateCategory, createCategory);
router.get('/:id', protect, validateCategoryId, getCategoryById);
router.put(
  '/:id',
  protect,
  allowRoles('Admin', 'Manager'),
  validateCategoryId,
  validateCategory,
  updateCategory
);
router.delete('/:id', protect, allowRoles('Admin', 'Manager'), validateCategoryId, deleteCategory);

export default router;
