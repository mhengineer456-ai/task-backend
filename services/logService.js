import { query, isConnected } from '../config/db.js';

class LogService {
  /**
   * Log an event to both console and MySQL system_logs table
   */
  async log({
    level = 'INFO',
    module = 'SYSTEM',
    action,
    userId = null,
    userName = null,
    userRole = null,
    ipAddress = null,
    userAgent = null,
    entityType = null,
    entityId = null,
    details = null,
    statusCode = 200,
    executionTimeMs = 0,
    errorMessage = null
  }) {
    const timestamp = new Date().toISOString();
    const logId = `log-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // 1. Formatted Console Output
    const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[36m';
    const reset = '\x1b[0m';
    console.log(`${color}[${timestamp}] [${level}] [${module}] ${action}${reset}${userId ? ` (User: ${userId})` : ''}${executionTimeMs ? ` [${executionTimeMs}ms]` : ''}`);

    // 2. Asynchronous Database Persistence
    if (isConnected()) {
      try {
        const detailsJson = details ? (typeof details === 'object' ? JSON.stringify(details) : details) : null;
        await query(
          `INSERT INTO system_logs (
            id, level, module, action, user_id, user_name, user_role,
            ip_address, user_agent, entity_type, entity_id, details,
            status_code, execution_time_ms, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            logId,
            level.toUpperCase(),
            module.toUpperCase(),
            action,
            userId,
            userName,
            userRole,
            ipAddress,
            userAgent ? userAgent.substring(0, 255) : null,
            entityType,
            entityId,
            detailsJson,
            statusCode,
            executionTimeMs,
            errorMessage
          ]
        );
      } catch (err) {
        console.warn('⚠️ [LogService] Failed to insert log into MySQL:', err.message);
      }
    }

    return logId;
  }

  info(module, action, data = {}) {
    return this.log({ level: 'INFO', module, action, ...data });
  }

  warn(module, action, data = {}) {
    return this.log({ level: 'WARN', module, action, ...data });
  }

  error(module, action, data = {}) {
    return this.log({ level: 'ERROR', module, action, ...data });
  }

  /**
   * Fetch logs with filtering and pagination
   */
  async getLogs({
    module = null,
    level = null,
    userId = null,
    action = null,
    limit = 50,
    offset = 0,
    startDate = null,
    endDate = null
  } = {}) {
    if (!isConnected()) return { total: 0, logs: [] };

    let conditions = [];
    let params = [];

    if (module) {
      conditions.push('module = ?');
      params.push(module.toUpperCase());
    }
    if (level) {
      conditions.push('level = ?');
      params.push(level.toUpperCase());
    }
    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
    if (action) {
      conditions.push('action LIKE ?');
      params.push(`%${action}%`);
    }
    if (startDate) {
      conditions.push('created_at >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('created_at <= ?');
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) as total FROM system_logs ${whereClause}`;
    const [countResult] = await query(countSql, params);
    const total = countResult ? countResult.total : 0;

    const selectSql = `
      SELECT * FROM system_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await query(selectSql, [...params, Number(limit), Number(offset)]);

    const formatted = (rows || []).map(r => ({
      ...r,
      details: typeof r.details === 'string' ? JSON.parse(r.details || 'null') : r.details
    }));

    return { total, logs: formatted };
  }

  /**
   * Fetch log metrics and statistics
   */
  async getLogStats() {
    if (!isConnected()) return { total: 0, byLevel: {}, byModule: {} };

    const [totalRow] = await query('SELECT COUNT(*) as total FROM system_logs');
    const levelRows = await query('SELECT level, COUNT(*) as count FROM system_logs GROUP BY level');
    const moduleRows = await query('SELECT module, COUNT(*) as count FROM system_logs GROUP BY module');
    const [recentErrors] = await query("SELECT COUNT(*) as count FROM system_logs WHERE level = 'ERROR' AND created_at >= NOW() - INTERVAL 24 HOUR");

    const byLevel = {};
    (levelRows || []).forEach(r => byLevel[r.level] = r.count);

    const byModule = {};
    (moduleRows || []).forEach(r => byModule[r.module] = r.count);

    return {
      total: totalRow ? totalRow.total : 0,
      recentErrors24h: recentErrors ? recentErrors.count : 0,
      byLevel,
      byModule
    };
  }
}

export const logService = new LogService();
export default logService;
