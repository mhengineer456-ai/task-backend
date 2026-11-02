import { Router } from 'express';
import {
  getFollowUps,
  createFollowUp,
  updateFollowUp,
  getMeetings,
  createMeeting,
  deleteMeeting,
  getDailyTasks,
  toggleDailyTask,
  createDailyTask,
  deleteDailyTask
} from '../controllers/eaController.js';

const router = Router();

// Follow-up Logs
router.get('/followups', getFollowUps);
router.post('/followups', createFollowUp);
router.put('/followups/:id', updateFollowUp);

// Executive Meetings Allotment
router.get('/meetings', getMeetings);
router.post('/meetings', createMeeting);
router.delete('/meetings/:id', deleteMeeting);

// EA Daily Routine Compliance Tasks & Working Lines
router.get('/daily-tasks', getDailyTasks);
router.post('/daily-tasks', createDailyTask);
router.put('/daily-tasks/:id', toggleDailyTask);
router.delete('/daily-tasks/:id', deleteDailyTask);

export default router;
