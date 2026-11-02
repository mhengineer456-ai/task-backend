import { Router } from 'express';
import { getLeaves, createLeave, approveLeave, rejectLeave } from '../controllers/leaveController.js';

const router = Router();

router.get('/', getLeaves);
router.post('/', createLeave);
router.put('/:id/approve', approveLeave);
router.put('/:id/reject', rejectLeave);

export default router;
