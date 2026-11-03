import express from 'express';
import {
  getCallHistory,
  logCall,
  getIceServers,
  deleteCallLog,
  generateCallAiSummary,
  getCallAiSummary,
  createTasksFromCallActionItems
} from '../controllers/callController.js';

const router = express.Router();

// Retrieve call history for a user
router.get('/history', getCallHistory);

// Log call completion/failure/missed
router.post('/log', logCall);

// WebRTC STUN/TURN ICE servers configuration
router.get('/ice-servers', getIceServers);

// Delete a call log
router.delete('/history/:id', deleteCallLog);

// AI Meeting Summarizer & Action Items
router.post('/:callId/ai-summary', generateCallAiSummary);
router.get('/:callId/ai-summary', getCallAiSummary);
router.post('/:callId/create-tasks', createTasksFromCallActionItems);

export default router;
