import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

function getDatabaseConfig() {
  const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.JAWSDB_URL;
  if (dbUrl) {
    try {
      const u = new URL(dbUrl);
      return {
        host: u.hostname,
        port: Number(u.port) || 3306,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, ''),
        waitForConnections: true,
        connectionLimit: 20,
        queueLimit: 0,
        connectTimeout: 15000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
      };
    } catch (e) {
      console.warn('⚠️ [Config] Could not parse database URL, falling back to individual env vars:', e.message);
    }
  }

  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT) || 3306,
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'taskpulse_db',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    connectTimeout: 15000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  };
}

export const config = {
  port: process.env.PORT || 5000,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  mysql: getDatabaseConfig(),
  dbPath: path.join(__dirname, '../data/db.json'),
  n8nChatWebhookUrl: process.env.N8N_CHAT_WEBHOOK_URL || 'http://localhost:5678/webhook/factory-ai-agents',
  n8nTestWebhookUrl: process.env.N8N_TEST_WEBHOOK_URL || 'http://localhost:5678/webhook/factory-ai-agents',
  geminiApiKey: process.env.GEMINI_API_KEY || ''
};
