import { logService } from '../services/logService.js';

export const getSystemLogs = async (req, res) => {
  try {
    const {
      module,
      level,
      userId,
      action,
      limit = 50,
      offset = 0,
      startDate,
      endDate
    } = req.query;

    const data = await logService.getLogs({
      module,
      level,
      userId,
      action,
      limit,
      offset,
      startDate,
      endDate
    });

    res.json({
      success: true,
      total: data.total,
      limit: Number(limit),
      offset: Number(offset),
      logs: data.logs
    });
  } catch (error) {
    console.error('Error in getSystemLogs controller:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve system logs' });
  }
};

export const getLogStats = async (req, res) => {
  try {
    const stats = await logService.getLogStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error in getLogStats controller:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve log statistics' });
  }
};
