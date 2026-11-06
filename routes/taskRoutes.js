import { Router } from 'express';
import { getTasks, createTask, updateTask, deleteTask, addFollowup, dispatchScheduledTask } from '../controllers/taskController.js';

const router = Router();

router.get('/', getTasks);
router.post('/', createTask);
router.put('/:id', updateTask);
router.post('/:id/dispatch-now', dispatchScheduledTask);
router.post('/:id/followups', addFollowup);
router.delete('/:id', deleteTask);

export default router;
