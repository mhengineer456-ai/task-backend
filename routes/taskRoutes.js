import { Router } from 'express';
import { getTasks, createTask, updateTask, deleteTask, addFollowup } from '../controllers/taskController.js';

const router = Router();

router.get('/', getTasks);
router.post('/', createTask);
router.put('/:id', updateTask);
router.post('/:id/followups', addFollowup);
router.delete('/:id', deleteTask);

export default router;
