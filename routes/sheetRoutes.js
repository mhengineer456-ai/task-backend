import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getSheetStatus,
  syncAllLinkedSheets,
  addLinkedSheet,
  fetchSheetValuesReadOnly,
  updateOAuthCredentials,
  getOAuthStatus
} from '../services/sheetRegistryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OAUTH_PATH = path.join(__dirname, '../config/googleSheetsOAuth.json');

const router = express.Router();

/**
 * GET /api/sheets/status
 * Returns list of linked sheets, row counts, last sync info, and read-only status
 */
router.get('/status', (req, res) => {
  try {
    const status = getSheetStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sheets/sync
 * Manually triggers a read-only refresh of all linked sheets
 */
router.post('/sync', async (req, res) => {
  try {
    // Run sync asynchronously
    syncAllLinkedSheets()
      .then(result => {
        console.log('Sync finished successfully:', result);
      })
      .catch(err => {
        console.error('Sync failed:', err);
      });

    res.json({
      success: true,
      message: 'Read-only sync initiated across all linked Google Sheets.',
      status: 'Syncing in background'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sheets/link
 * Links a new Google Sheet to the system (strictly Read-Only)
 */
router.post('/link', async (req, res) => {
  try {
    const { spreadsheetId, tabName, displayName, category, description, keyColumn } = req.body;
    if (!spreadsheetId || !tabName) {
      return res.status(400).json({
        success: false,
        error: 'Both spreadsheetId and tabName are required to link a sheet.'
      });
    }

    const result = await addLinkedSheet({
      spreadsheetId: String(spreadsheetId).trim(),
      tabName: String(tabName).trim(),
      displayName,
      category,
      description,
      keyColumn
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({
      success: false,
      error: `Could not link sheet: ${err.message}`
    });
  }
});

/**
 * GET /api/sheets/preview
 * Read-only preview of any linked sheet or specific range
 */
router.get('/preview', async (req, res) => {
  try {
    const { spreadsheetId, tabName } = req.query;
    if (!spreadsheetId || !tabName) {
      return res.status(400).json({ success: false, error: 'spreadsheetId and tabName are required.' });
    }

    const data = await fetchSheetValuesReadOnly(String(spreadsheetId), String(tabName));
    res.json({
      success: true,
      headers: data.headers,
      sampleRows: data.rows.slice(0, 10),
      totalRows: data.totalRows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sheets/oauth/status
 * Check if the Google OAuth token is currently active or expired
 */
router.get('/oauth/status', async (req, res) => {
  try {
    const status = await getOAuthStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sheets/oauth/update
 * Update and test new Google OAuth credentials directly
 */
router.post('/oauth/update', async (req, res) => {
  try {
    const { refreshToken, clientId, clientSecret } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'refreshToken is required.' });
    }
    const result = await updateOAuthCredentials({ refreshToken, clientId, clientSecret });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sheets/oauth/authorize
 * Redirects user to Google OAuth consent screen to authorize offline access
 */
router.get('/oauth/authorize', (req, res) => {
  try {
    if (!fs.existsSync(OAUTH_PATH)) {
      return res.status(500).send('googleSheetsOAuth.json not found.');
    }
    const oauthConfig = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
    const redirectUri = `${req.protocol}://${req.get('host')}/api/sheets/oauth/callback`;
    const scope = encodeURIComponent('https://www.googleapis.com/auth/spreadsheets.readonly');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${oauthConfig.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;

    res.redirect(authUrl);
  } catch (err) {
    res.status(500).send(`Error generating auth URL: ${err.message}`);
  }
});

/**
 * GET /api/sheets/oauth/callback
 * Handles Google OAuth redirect callback, exchanges authorization code for tokens
 */
router.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`<h3>Authorization error from Google:</h3><p>${error}</p>`);
  }
  if (!code) {
    return res.status(400).send('<h3>No authorization code provided by Google.</h3>');
  }

  try {
    const oauthConfig = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
    const redirectUri = `${req.protocol}://${req.get('host')}/api/sheets/oauth/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return res.status(400).send(`<h3>Token Exchange Failed (${tokenRes.status}):</h3><pre>${errText}</pre>`);
    }

    const tokenData = await tokenRes.json();
    if (!tokenData.refresh_token) {
      return res.status(400).send('<h3>Google did not return a refresh_token.</h3><p>Make sure prompt=consent is used, or revoke app permissions in Google Account Security settings first.</p>');
    }

    await updateOAuthCredentials({
      clientId: oauthConfig.clientId,
      clientSecret: oauthConfig.clientSecret,
      refreshToken: tokenData.refresh_token
    });

    res.send(`
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 60px 20px; background: #0f172a; color: #f8fafc; min-height: 100vh;">
        <div style="max-width: 500px; margin: 0 auto; background: #1e293b; padding: 32px; border-radius: 12px; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
          <h2 style="color: #38bdf8; margin-top: 0;">Authorization Successful!</h2>
          <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
            Your new Google OAuth2 refresh token has been stored securely and live Google Sheets sync has been restored.
          </p>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">
            You can safely close this browser window and return to TaskPulse Pro.
          </p>
        </div>
      </div>
    `);
  } catch (err) {
    res.status(500).send(`<h3>Server error during token exchange:</h3><p>${err.message}</p>`);
  }
});

export default router;
