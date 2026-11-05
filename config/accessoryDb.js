import mysql from 'mysql2/promise';
import { config } from './config.js';

let accessoryPool = null;
let isAccessoryMysqlConnected = false;
let lastConnectionError = null;
let activeAccessoryConfig = null;
let cachedTableCounts = {
  materials: 0,
  weight_capture: 0,
  issue_logs: 0,
  zip: 0,
  dori: 0,
  material_transfers: 0,
  rgp: 0,
  scans: 0,
  approval_requests: 0,
  purchase_orders: 0,
  lastChecked: null
};

/**
 * Initializes MySQL Connection Pool for the Accessory Software Database
 * (supports different credentials, remote host, or local database e.g. 'newdata' with auto-failover)
 */
export async function initAccessoryDatabase() {
  const primaryCfg = config.accessoryMysql;
  const configsToTry = [];

  if (primaryCfg && primaryCfg.database) {
    const { isFallback, ...rest } = primaryCfg;
    configsToTry.push({ poolConfig: rest, isFallback: false });

    // If configured with internal Railway hostname but running outside Railway, add public proxy
    if (primaryCfg.host === 'mysql.railway.internal') {
      configsToTry.push({
        poolConfig: {
          ...rest,
          host: 'monorail.proxy.rlwy.net',
          port: 43485
        },
        isFallback: false
      });
    }
  }

  // Also include the verified public Railway database as high-priority fallback
  const isAlreadyRailwayPublic = primaryCfg && primaryCfg.host === 'monorail.proxy.rlwy.net';
  if (!isAlreadyRailwayPublic) {
    configsToTry.push({
      poolConfig: {
        host: 'monorail.proxy.rlwy.net',
        port: 43485,
        user: 'root',
        password: process.env.ACCESSORY_DB_PASSWORD || 'CSqIYNzEXEUZqwelyqaTvUtNjKZGYPBF',
        database: 'railway',
        waitForConnections: true,
        connectionLimit: 25,
        queueLimit: 0,
        connectTimeout: 8000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
      },
      isFallback: true
    });
  }

  // Add local fallback configuration pointing to 'newdata' if not identical
  const localFallbackPoolConfig = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: process.env.DB_PASSWORD || 'Mohitca011',
    database: 'newdata',
    waitForConnections: true,
    connectionLimit: 25,
    queueLimit: 0,
    connectTimeout: 8000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  };

  const isAlreadyPrimaryLocal = primaryCfg &&
    (primaryCfg.host === 'localhost' || primaryCfg.host === '127.0.0.1') &&
    primaryCfg.database === 'newdata';

  if (!isAlreadyPrimaryLocal) {
    configsToTry.push({ poolConfig: localFallbackPoolConfig, isFallback: true });
  }

  for (const entry of configsToTry) {
    const cfg = entry.poolConfig;
    const isFallback = entry.isFallback;
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
        activeAccessoryConfig = { ...cfg, isFallback };
        console.log(`✅ [Accessory SQL DB] Connected successfully to database: "${cfg.database}" on ${cfg.host}:${cfg.port} (user: ${cfg.user})${isFallback ? ' [Auto-Failover Local]' : ''}`);

        // Refresh table counts in background
        refreshAccessoryTableCounts().catch(() => {});
        return true;
      }
    } catch (err) {
      lastConnectionError = err.message;
      console.warn(`⚠️ [Accessory SQL DB] Connection notice (${cfg.host}:${cfg.port}/${cfg.database}): ${err.message}.`);
      if (accessoryPool) {
        try { await accessoryPool.end(); } catch (e) {}
        accessoryPool = null;
      }
    }
  }

  isAccessoryMysqlConnected = false;
  console.warn(`⚠️ [Accessory SQL DB] All database connections exhausted. Accessory features will run in fallback mode.`);
  return false;
}

/**
 * Refresh count statistics for key accessory software tables in SQL database
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

    // Material Transfers (Warehouse location movements)
    const [[mt]] = await accessoryPool.query('SELECT COUNT(*) as c FROM material_transfers').catch(() => [[{ c: 0 }]]);
    counts.material_transfers = mt?.c || 0;

    // Returnable Gate Passes (RGPs)
    const [[rg]] = await accessoryPool.query('SELECT COUNT(*) as c FROM rgp').catch(() => [[{ c: 0 }]]);
    counts.rgp = rg?.c || 0;

    // Inward Barcode Scans
    const [[sc]] = await accessoryPool.query('SELECT COUNT(*) as c FROM scans').catch(() => [[{ c: 0 }]]);
    counts.scans = sc?.c || 0;

    // Approval Requests
    const [[ap]] = await accessoryPool.query('SELECT COUNT(*) as c FROM approval_requests').catch(() => [[{ c: 0 }]]);
    counts.approval_requests = ap?.c || 0;

    // Purchase Orders
    const [[po]] = await accessoryPool.query('SELECT COUNT(*) as c FROM purchase_orders').catch(() => [[{ c: 0 }]]);
    counts.purchase_orders = po?.c || 0;

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
    // Check if connection lost, mark disconnected and attempt reconnect
    if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST') {
      isAccessoryMysqlConnected = false;
      lastConnectionError = err.message;
      // Trigger lazy reconnect on next tick
      initAccessoryDatabase().catch(() => {});
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
  const cfg = activeAccessoryConfig || config.accessoryMysql || {};
  return {
    connected: isAccessoryConnected(),
    host: cfg.host || 'localhost',
    port: cfg.port || 3306,
    database: cfg.database || 'newdata',
    user: cfg.user || 'root',
    isFallback: !!cfg.isFallback,
    error: lastConnectionError,
    tableCounts: cachedTableCounts,
    timestamp: new Date().toISOString()
  };
}
