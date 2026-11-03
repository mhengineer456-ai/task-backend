import express from 'express';
import {
  getStatusFeed,
  createStatus,
  recordStatusView,
  getStatusViews,
  deleteStatus,
  getStatusPrivacy,
  updateStatusPrivacy,
  replyToStatus
} from '../controllers/statusController.js';

const router = express.Router();

// Status feed (My Status, Recent Updates, Viewed Updates)
router.get('/feed', getStatusFeed);

// Create new status (Text, Photo, Video)
router.post('/', createStatus);

// Record status view (strictly authentic unique views)
router.post('/:statusId/view', recordStatusView);

// Get viewer list for my status (strictly authorized to status owner)
router.get('/:statusId/views', getStatusViews);

// Delete my status
router.delete('/:statusId', deleteStatus);

// Status privacy settings
router.get('/privacy/:userId', getStatusPrivacy);
router.put('/privacy/:userId', updateStatusPrivacy);

// Reply to a contact's status
router.post('/:statusId/reply', replyToStatus);

export default router;
