import http from 'http';
import express from 'express';
import cors from 'cors';
import { config } from './config/config.js';
import { initDatabase, isConnected } from './config/db.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { initSocket } from './socket.js';

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import leaveRoutes from './routes/leaveRoutes.js';
import eaRoutes from './routes/eaRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import logRoutes from './routes/logRoutes.js';
import sheetRoutes from './routes/sheetRoutes.js';
import { startAutoSyncSchedule } from './services/sheetRegistryService.js';

const app = express();
const server = http.createServer(app);

// Initialize Real-Time WebSockets
initSocket(server, config.corsOrigin);

// Global Middlewares
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));
app.use(requestLogger);

// Diagnostic Health Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'TaskPulse Pro Enterprise MySQL REST & Socket.IO Server',
    database: isConnected() ? 'MySQL Connected' : 'Fallback Mode Active',
    realtime: 'Socket.IO Active',
    environment: 'production',
    timestamp: new Date().toISOString()
  });
});

// Modular API Routers
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/ea', eaRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/sheets', sheetRoutes);

// Error Handling Middleware
app.use(errorHandler);

// Initialize Database & Start Express + Socket Server
async function startServer() {
  await initDatabase();

  // Start automatic read-only Google Sheets background sync (every 20 min)
  startAutoSyncSchedule(20);

  server.listen(config.port, () => {
    console.log(`🚀 TaskPulse Pro Enterprise Server & Socket.IO running on http://localhost:${config.port}`);
  });
}

startServer();
