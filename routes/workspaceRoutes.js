import { Router } from 'express';
import {
  getReminders,
  createReminder,
  toggleReminderStatus,
  deleteReminder,
  getTimeLogs,
  createTimeLog,
  deleteTimeLog,
  getDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  getNotes,
  createNote,
  updateNote,
  deleteNote,
  getCustomLists,
  createCustomList,
  updateCustomList,
  deleteCustomList
} from '../controllers/workspaceController.js';

const router = Router();

// Reminders
router.get('/reminders', getReminders);
router.post('/reminders', createReminder);
router.patch('/reminders/:id/status', toggleReminderStatus);
router.delete('/reminders/:id', deleteReminder);

// Time Logs
router.get('/timelogs', getTimeLogs);
router.post('/timelogs', createTimeLog);
router.delete('/timelogs/:id', deleteTimeLog);

// Documents
router.get('/docs', getDocuments);
router.post('/docs', createDocument);
router.put('/docs/:id', updateDocument);
router.delete('/docs/:id', deleteDocument);

// Personal Notes
router.get('/notes', getNotes);
router.post('/notes', createNote);
router.put('/notes/:id', updateNote);
router.delete('/notes/:id', deleteNote);

// Custom Lists
router.get('/lists', getCustomLists);
router.post('/lists', createCustomList);
router.put('/lists/:id', updateCustomList);
router.delete('/lists/:id', deleteCustomList);

export default router;
