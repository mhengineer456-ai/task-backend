import { Router } from 'express';
import { getUsers, getUserById, updateUserProfile } from '../controllers/userController.js';

const router = Router();

router.get('/', getUsers);
router.get('/:id', getUserById);
router.put('/:id/profile', updateUserProfile);

export default router;
