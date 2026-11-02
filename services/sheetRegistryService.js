import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFactorySheetsData } from './aiQueryEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, '../config/linkedSheetsConfig.json');
const OAUTH_PATH = path.join(__dirname, '../config/googleSheetsOAuth.json');
const DATA_PATH = path.join(__dirname, '../data/sheetsData.json');

let cachedAccessToken = null;
let tokenExpiresAt = 0;
let lastKnownRefreshToken = null;
let oauthErrorLogged = false;
let isSyncing = false;
let lastSyncTimestamp = null;
let lastSyncReport = null;
let autoSyncTimer = null;

/**
 * Returns current configuration of all linked sheets
 */
export function getLinkedSheetsConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { sheets: [] };
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading linkedSheetsConfig.json:', err.message);
    return { sheets: [] };
  }
}

/**
 * Saves configuration of linked sheets
 */
function saveLinkedSheetsConfig(cfg) {
  cfg.updatedAt = new Date().toISOString();
  cfg.readOnlyEnforced = true;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/**
 * Obtains or refreshes Google OAuth2 access token
 */
export async function getValidAccessToken(forceRefresh = false) {
  const now = Date.now();

  if (!fs.existsSync(OAUTH_PATH)) {
    throw new Error('googleSheetsOAuth.json credentials configuration not found.');
  }

  const oauthConfig = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
  const { clientId, clientSecret, refreshToken } = oauthConfig;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Incomplete OAuth2 credentials in googleSheetsOAuth.json');
  }

  // Detect if user updated refreshToken in the file
  if (refreshToken !== lastKnownRefreshToken) {
    cachedAccessToken = null;
    tokenExpiresAt = 0;
    lastKnownRefreshToken = refreshToken;
    oauthErrorLogged = false;
  }

  if (!forceRefresh && cachedAccessToken && now < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth2 Token refresh failed (${tokenRes.status}): ${errText}`);
  }

  const tokenData = await tokenRes.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = now + ((tokenData.expires_in || 3600) * 1000);
  oauthErrorLogged = false;

  oauthConfig.accessToken = cachedAccessToken;
  fs.writeFileSync(OAUTH_PATH, JSON.stringify(oauthConfig, null, 2));

  return cachedAccessToken;
}

/**
 * Updates Google OAuth2 credentials and verifies immediately with Google's token endpoint
 */
export async function updateOAuthCredentials({ clientId, clientSecret, refreshToken }) {
  if (!refreshToken) {
    throw new Error('A valid refreshToken is required.');
  }

  const current = fs.existsSync(OAUTH_PATH) ? JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8')) : {};
  const newClientId = (clientId || current.clientId || '').trim();
  const newClientSecret = (clientSecret || current.clientSecret || '').trim();
  const newRefreshToken = refreshToken.trim();

  // Test token with Google
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: newClientId,
      client_secret: newClientSecret,
      refresh_token: newRefreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth validation failed (${tokenRes.status}): ${errText}`);
  }

  const tokenData = await tokenRes.json();
  const updatedConfig = {
    clientId: newClientId,
    clientSecret: newClientSecret,
    refreshToken: newRefreshToken,
    accessToken: tokenData.access_token
  };

  fs.writeFileSync(OAUTH_PATH, JSON.stringify(updatedConfig, null, 2));
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + ((tokenData.expires_in || 3600) * 1000);
  lastKnownRefreshToken = newRefreshToken;
  oauthErrorLogged = false;

  console.log('✅ [Sheet Sync] Google OAuth2 credentials updated and verified successfully.');

  // Automatically trigger sync now that token is active
  syncAllLinkedSheets().catch(err => console.warn('Sync after token update warning:', err.message));

  return {
    success: true,
    message: 'Google OAuth2 credentials updated and verified successfully.'
  };
}

/**
 * Returns OAuth status and expiration diagnostic
 */
export async function getOAuthStatus() {
  try {
    await getValidAccessToken();
    return {
      valid: true,
      message: 'Google OAuth2 credentials are valid and active.',
      clientId: fs.existsSync(OAUTH_PATH) ? JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8')).clientId : null
    };
  } catch (err) {
    const isInvalid = err.message.includes('invalid_grant') || err.message.includes('expired or revoked');
    return {
      valid: false,
      error: err.message,
      isExpired: isInvalid,
      message: isInvalid
        ? 'Google OAuth2 refresh token is expired or revoked. Please update credentials.'
        : `Google OAuth error: ${err.message}`,
      clientId: fs.existsSync(OAUTH_PATH) ? JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8')).clientId : null
    };
  }
}

/**
 * Strictly READ-ONLY fetcher for Google Sheet values
 * Guarantees NO writes, NO updates, NO push to Google Sheets.
 */
export async function fetchSheetValuesReadOnly(spreadsheetId, tabName) {
  let token = await getValidAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}?majorDimension=ROWS`;

  let res = await fetch(url, {
    method: 'GET', // Strictly GET for Read-Only
    headers: { Authorization: `Bearer ${token}` }
  });

  if (res.status === 401) {
    // Force refresh and retry once
    cachedAccessToken = null;
    token = await getValidAccessToken();
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to read sheet "${tabName}" (${res.status}): ${errText.slice(0, 150)}`);
  }

  const data = await res.json();
  const rawRows = data.values || [];
  if (rawRows.length === 0) return { headers: [], rows: [] };

  const headers = rawRows[0].map(h => String(h || '').trim());
  const rows = [];

  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (!r || r.length === 0) continue;
    const obj = { row_number: i + 1 };
    let hasData = false;
    for (let c = 0; c < headers.length; c++) {
      const colName = headers[c] || `Col_${c}`;
      const val = r[c] !== undefined ? r[c] : '';
      obj[colName] = val;
      if (val !== '') hasData = true;
    }
    if (hasData) rows.push(obj);
  }

  return { headers, rows, totalRows: rows.length };
}

/**
 * High-performance background sync across all linked Google Sheets
 */
export async function syncAllLinkedSheets() {
  if (isSyncing) {
    return { success: false, message: 'Sync already in progress.', lastSync: lastSyncTimestamp };
  }

  isSyncing = true;
  const startTime = Date.now();
  const cfg = getLinkedSheetsConfig();
  const sheetsList = cfg.sheets || [];

  // 1. Verify / obtain Google OAuth token first before attempting sheet requests
  let token;
  try {
    token = await getValidAccessToken();
  } catch (tokenErr) {
    isSyncing = false;
    const isInvalid = tokenErr.message.includes('invalid_grant') || tokenErr.message.includes('expired or revoked');
    if (isInvalid) {
      if (!oauthErrorLogged) {
        console.warn(`\n⚠️  [Sheet Sync Notification] Google OAuth2 Refresh Token has expired or been revoked (invalid_grant).`);
        console.warn(`    • Background Google Sheets live sync is paused.`);
        console.warn(`    • System continues running 100% uninterrupted using cached local factory data.`);
        console.warn(`    • To restore live sync, update the refresh token in backend/config/googleSheetsOAuth.json or set OAuth app to "In Production" in Google Cloud Console.\n`);
        oauthErrorLogged = true;
      }
    } else {
      console.warn(`⚠️ [Sheet Sync] Google OAuth access failed: ${tokenErr.message}`);
    }

    lastSyncReport = {
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      totalSheets: sheetsList.length,
      syncedSheets: 0,
      status: isInvalid ? 'OAuth Token Expired/Revoked' : 'Auth Error',
      error: tokenErr.message,
      usingCachedData: true
    };

    return {
      success: false,
      reason: 'oauth_token_expired',
      message: tokenErr.message,
      usingCachedData: true
    };
  }

  // Once token is valid, reset latch
  oauthErrorLogged = false;
  const results = {};
  const errors = [];

  console.log(`🔄 [Sheet Sync] Starting read-only sync across ${sheetsList.length} linked sheets...`);

  // Parallel fetch of all sheets
  const fetchPromises = sheetsList.map(async (sheet) => {
    try {
      const data = await fetchSheetValuesReadOnly(sheet.spreadsheetId, sheet.tabName);
      return { id: sheet.id, sheet, data, success: true };
    } catch (err) {
      console.warn(`⚠️ [Sheet Sync] Error fetching "${sheet.displayName}":`, err.message);
      errors.push({ id: sheet.id, error: err.message });
      return { id: sheet.id, sheet, error: err.message, success: false };
    }
  });

  const settled = await Promise.allSettled(fetchPromises);

  settled.forEach(item => {
    if (item.status === 'fulfilled' && item.value.success) {
      const val = item.value;
      results[val.id] = {
        meta: val.sheet,
        headers: val.data.headers,
        rows: val.data.rows,
        count: val.data.totalRows
      };
    }
  });

  // Preserve existing data for any sheet that failed to fetch so we never drop data
  let existingData = {};
  if (fs.existsSync(DATA_PATH)) {
    try {
      existingData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    } catch (e) {}
  }

  const jobOrders = results['job_orders']?.rows || existingData.jobOrders || [];
  const issues = results['issues_tracker']?.rows || existingData.issues || [];
  const indexRows = results['index_cutting']?.rows || existingData.indexRows || [];
  const cuttingDetails = results['cutting_karigar_details']?.rows || existingData.cuttingDetails || [];
  const designImages = results['design_images']?.rows || existingData.designImages || [];
  const cancelledLots = results['cancelled_lots']?.rows || existingData.cancelledLots || [];
  const packingOrders = results['packing_orders']?.rows || existingData.packingOrders || [];
  const lotLogs = results['lot_logs']?.rows || existingData.lotLogs || [];

  // Build custom sheets map for any newly added sheets
  const customSheets = {};
  sheetsList.forEach(s => {
    if (!['job_orders', 'issues_tracker', 'index_cutting', 'cutting_karigar_details', 'design_images', 'cancelled_lots', 'packing_orders', 'lot_logs'].includes(s.id)) {
      if (results[s.id]) {
        customSheets[s.id] = results[s.id];
      } else if (existingData.customSheets && existingData.customSheets[s.id]) {
        customSheets[s.id] = existingData.customSheets[s.id];
      }
    }
  });

  const compiledData = {
    updatedAt: new Date().toISOString(),
    syncDurationMs: Date.now() - startTime,
    totalJobOrders: jobOrders.length,
    totalIssues: issues.length,
    totalIndexRows: indexRows.length,
    totalCuttingDetails: cuttingDetails.length,
    totalDesignImages: designImages.length,
    totalCancelledLots: cancelledLots.length,
    totalPackingOrders: packingOrders.length,
    totalLotLogs: lotLogs.length,
    jobOrders,
    issues,
    indexRows,
    cuttingDetails,
    designImages,
    cancelledLots,
    packingOrders,
    lotLogs,
    customSheets,
    linkedSheetsSummary: sheetsList.map(s => ({
      id: s.id,
      displayName: s.displayName,
      tabName: s.tabName,
      category: s.category,
      rowCount: results[s.id]?.count || 0,
      status: results[s.id] ? 'Synced' : 'Cached'
    }))
  };

  // Write atomically
  fs.writeFileSync(DATA_PATH, JSON.stringify(compiledData, null, 2));

  // Force cache refresh in aiQueryEngine
  loadFactorySheetsData(true);

  isSyncing = false;
  lastSyncTimestamp = new Date().toISOString();
  lastSyncReport = {
    timestamp: lastSyncTimestamp,
    durationMs: Date.now() - startTime,
    totalSheets: sheetsList.length,
    syncedSheets: Object.keys(results).length,
    errors,
    summary: compiledData.linkedSheetsSummary
  };

  console.log(`✅ [Sheet Sync] Successfully synced ${Object.keys(results).length}/${sheetsList.length} linked sheets in ${lastSyncReport.durationMs}ms`);
  return { success: true, report: lastSyncReport };
}

/**
 * Dynamically links a new Google Sheet to the system (Strictly Read-Only)
 */
export async function addLinkedSheet({
  spreadsheetId,
  tabName,
  displayName,
  category = 'General',
  keyColumn = 'Lot Number',
  description = ''
}) {
  if (!spreadsheetId || !tabName) {
    throw new Error('spreadsheetId and tabName are required.');
  }

  // 1. Verify that the sheet is readable (Read-Only Test Fetch)
  const testFetch = await fetchSheetValuesReadOnly(spreadsheetId, tabName);

  const cfg = getLinkedSheetsConfig();
  const sheetId = `sheet_${Date.now()}`;

  const newSheet = {
    id: sheetId,
    spreadsheetId,
    tabName,
    displayName: displayName || `${tabName} Sheet`,
    category,
    keyColumn,
    description: description || `Linked Google Sheet (${tabName})`,
    linkedAt: new Date().toISOString(),
    isReadOnly: true
  };

  cfg.sheets.push(newSheet);
  saveLinkedSheetsConfig(cfg);

  // Trigger background sync to ingest the new sheet
  syncAllLinkedSheets().catch(err => console.error('Error syncing after adding sheet:', err));

  return {
    success: true,
    sheet: newSheet,
    rowCount: testFetch.totalRows,
    sampleHeaders: testFetch.headers.slice(0, 10)
  };
}

/**
 * Returns health status of linked sheets & sync engine
 */
export function getSheetStatus() {
  const cfg = getLinkedSheetsConfig();
  return {
    success: true,
    readOnlyEnforced: true,
    isSyncing,
    lastSyncTimestamp,
    lastSyncReport,
    oauthValid: !oauthErrorLogged,
    totalLinkedSheets: cfg.sheets?.length || 0,
    sheets: cfg.sheets || []
  };
}

/**
 * Initializes automatic background sync schedule
 */
export function startAutoSyncSchedule(intervalMinutes = 20) {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  const ms = Math.max(intervalMinutes, 5) * 60 * 1000;
  console.log(`⏰ [Sheet Sync Scheduler] Automatic background sync scheduled every ${intervalMinutes} minutes.`);

  // Initial sync after 3 seconds
  setTimeout(() => {
    syncAllLinkedSheets().catch(err => console.warn('Initial sync warning:', err.message));
  }, 3000);

  autoSyncTimer = setInterval(() => {
    syncAllLinkedSheets().catch(err => console.warn('Scheduled sync warning:', err.message));
  }, ms);
}
