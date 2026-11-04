import mysql from 'mysql2/promise';
import { config } from './config.js';

let accessoryPool = null;
let isAccessoryMysqlConnected = false;
let lastConnectionError = null;
let cachedTableCounts = {
  materials: 0,
  weight_capture: 0,
  issue_logs: 0,
  zip: 0,
  dori: 0,
  lastChecked: null
};

/**
 * Initializes MySQL Connection Pool for the Accessory Software Database
 * (supports different credentials, remote host, or local database e.g. 'newdata')
 */
export async function initAccessoryDatabase() {
  const cfg = config.accessoryMysql;
  if (!cfg || !cfg.database) {
    console.warn('⚠️ [Accessory DB] No accessory database configuration specified.');
    isAccessoryMysqlConnected = false;
    return false;
  }

  try {
    if (accessoryPool) {
      try {
        await accessoryPool.end();
      } catch (e) {
        // ignore closing error
      }
      accessoryPool = null;
    }

    accessoryPool = mysql.createPool(cfg);

    // Test ping
    const [pingRes] = await accessoryPool.query('SELECT 1 as alive');
    if (pingRes && pingRes[0]?.alive === 1) {
      isAccessoryMysqlConnected = true;
      lastConnectionError = null;
      console.log(`✅ [Accessory SQL DB] Connected successfully to database: "${cfg.database}" on ${cfg.host}:${cfg.port} (user: ${cfg.user})`);

      // Refresh table counts in background
      refreshAccessoryTableCounts().catch(() => {});
      return true;
    }
    return false;
  } catch (err) {
    isAccessoryMysqlConnected = false;
    lastConnectionError = err.message;
    console.warn(`⚠️ [Accessory SQL DB] Connection notice (${cfg.host}:${cfg.port}/${cfg.database}): ${err.message}. Accessory features will run in fallback mode.`);
    return false;
  }
}

/**
 * Refresh count statistics for key accessory software tables
 */
export async function refreshAccessoryTableCounts() {
  if (!accessoryPool || !isAccessoryMysqlConnected) return cachedTableCounts;

  const counts = { ...cachedTableCounts };

  try {
    const [[wc]] = await accessoryPool.query('SELECT COUNT(*) as c FROM weight_capture').catch(() => [[{ c: 0 }]]);
    counts.weight_capture = wc?.c || 0;

    const [[mat]] = await accessoryPool.query('SELECT COUNT(*) as c FROM materials').catch(() => [[{ c: 0 }]]);
    counts.materials = mat?.c || 0;

    const [[il]] = await accessoryPool.query('SELECT COUNT(*) as c FROM issue_logs').catch(() => [[{ c: 0 }]]);
    counts.issue_logs = il?.c || 0;

    const [[zp]] = await accessoryPool.query('SELECT COUNT(*) as c FROM zip').catch(() => [[{ c: 0 }]]);
    counts.zip = zp?.c || 0;

    // Check dori_issue or doori
    const [[di]] = await accessoryPool.query('SELECT COUNT(*) as c FROM dori_issue').catch(() => {
      return accessoryPool.query('SELECT COUNT(*) as c FROM doori').catch(() => [[{ c: 0 }]]);
    });
    counts.dori = di?.c || 0;

    counts.lastChecked = new Date().toISOString();
    cachedTableCounts = counts;
  } catch (e) {
    // Non-fatal
  }

  return cachedTableCounts;
}

/**
 * Universal query runner for Accessory Database
 */
export async function accessoryQuery(sql, params = []) {
  if (!accessoryPool) {
    await initAccessoryDatabase();
  }

  if (!accessoryPool) {
    throw new Error('Accessory database pool is not initialized');
  }

  try {
    const [results] = await accessoryPool.query(sql, params);
    isAccessoryMysqlConnected = true;
    return results;
  } catch (err) {
    // Check if connection lost, mark disconnected
    if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST') {
      isAccessoryMysqlConnected = false;
      lastConnectionError = err.message;
    }
    console.warn(`⚠️ [Accessory DB Query Error]: ${err.message} | SQL: ${sql.slice(0, 100)}`);
    throw err;
  }
}

/**
 * Check if Accessory SQL database is currently connected
 */
export function isAccessoryConnected() {
  return isAccessoryMysqlConnected && accessoryPool !== null;
}

/**
 * Get detailed accessory database status for API and AI assistant
 */
export function getAccessoryDbStatus() {
  const cfg = config.accessoryMysql || {};
  return {
    connected: isAccessoryConnected(),
    host: cfg.host || 'unknown',
    port: cfg.port || 3306,
    database: cfg.database || 'newdata',
    user: cfg.user || 'root',
    error: lastConnectionError,
    tableCounts: cachedTableCounts,
    timestamp: new Date().toISOString()
  };
}
