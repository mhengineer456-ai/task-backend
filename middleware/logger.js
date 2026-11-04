import { logService } from '../services/logService.js';

export const requestLogger = (req, res, next) => {
  const start = process.hrtime.bigint();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
  const userAgent = req.headers['user-agent'] || '';

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number((end - start) / 1000000n);

    // Skip high-frequency health probes from bloating DB
    if (req.url === '/api/health') return;

    const statusCode = res.statusCode;
    const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';

    // Extract module from path e.g. /api/chat/... -> CHAT
    const pathParts = req.path.split('/').filter(Boolean);
    const module = (pathParts[1] || 'API').toUpperCase();

    // Try extracting user ID from headers or query if present
    const userId = req.headers['x-user-id'] || req.query.userId || req.body?.senderId || req.body?.userId || null;
    const userName = req.headers['x-user-name'] || req.body?.senderName || req.body?.userName || null;

    // In high-traffic cloud deployments, do not write read-only GET requests to the database.
    // Only persist errors (>= 400) or state mutations (POST, PUT, DELETE) to prevent pool starvation.
    const shouldPersistToDb = statusCode >= 400 || req.method !== 'GET';

    if (shouldPersistToDb) {
      logService.log({
        level,
        module,
        action: `${req.method} ${req.originalUrl || req.url}`,
        userId,
        userName,
        ipAddress: typeof ip === 'string' ? ip.split(',')[0].trim() : String(ip),
        userAgent,
        statusCode,
        executionTimeMs: durationMs,
        details: {
          method: req.method,
          path: req.path,
          query: req.query,
          statusCode
        }
      }).catch(() => {});
    } else {
      const color = '\x1b[36m';
      const reset = '\x1b[0m';
      console.log(`${color}[${new Date().toISOString()}] [INFO] [${module}] ${req.method} ${req.originalUrl || req.url}${reset} [${durationMs}ms]`);
    }
  });

  next();
};

export default requestLogger;
