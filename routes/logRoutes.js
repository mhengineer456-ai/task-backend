import express from 'express';
import { getSystemLogs, getLogStats } from '../controllers/logController.js';

const router = express.Router();

router.get('/', getSystemLogs);
router.get('/stats', getLogStats);

export default router;
