/**
 * Quick Utility Script to Test & Update Google Sheets OAuth2 Refresh Token
 * 
 * Usage:
 *   node backend/scripts/update_oauth_token.js <NEW_REFRESH_TOKEN>
 *   (or run with no arguments to check current token status)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OAUTH_PATH = path.join(__dirname, '../config/googleSheetsOAuth.json');

async function main() {
  if (!fs.existsSync(OAUTH_PATH)) {
    console.error('❌ Error: backend/config/googleSheetsOAuth.json not found.');
    process.exit(1);
  }

  const oauth = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
  const newToken = process.argv[2]?.trim();

  const tokenToTest = newToken || oauth.refreshToken;

  console.log('---------------------------------------------------------');
  console.log(' Google Sheets OAuth Token Health Check & Updater');
  console.log('---------------------------------------------------------');
  console.log(`Client ID: ${oauth.clientId}`);
  console.log(`Testing Refresh Token: ${tokenToTest ? `${tokenToTest.slice(0, 15)}...${tokenToTest.slice(-6)}` : '(none)'}`);

  if (!tokenToTest) {
    console.error('❌ No refresh token found. Pass one as an argument:');
    console.error('   node backend/scripts/update_oauth_token.js <NEW_REFRESH_TOKEN>');
    process.exit(1);
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        refresh_token: tokenToTest,
        grant_type: 'refresh_token'
      })
    });

    const body = await res.json();

    if (!res.ok) {
      console.error('\n❌ Token verification failed:');
      console.error(`HTTP ${res.status}:`, JSON.stringify(body, null, 2));
      if (body.error === 'invalid_grant') {
        console.log('\n💡 Why this happened:');
        console.log('1. The refresh token was expired (Google expires tokens after 7 days if the OAuth Consent Screen is in "Testing" mode).');
        console.log('2. Or permissions were revoked/changed in Google Account Security.');
        console.log('\n🔧 How to fix:');
        console.log('1. Go to Google Cloud Console (console.cloud.google.com) -> APIs & Services -> OAuth consent screen.');
        console.log('2. Set Publishing Status to "In Production" (Click "PUBLISH APP"). This stops tokens from expiring after 7 days.');
        console.log('3. Generate a new refresh token using Google OAuth Playground or authorization link.');
        console.log('4. Run: node backend/scripts/update_oauth_token.js <NEW_REFRESH_TOKEN>');
      }
      process.exit(1);
    }

    console.log('\n✅ Token is VALID!');
    console.log(`Access Token generated: ${body.access_token.slice(0, 20)}...`);
    console.log(`Expires in: ${body.expires_in} seconds`);

    if (newToken) {
      oauth.refreshToken = newToken;
      oauth.accessToken = body.access_token;
      fs.writeFileSync(OAUTH_PATH, JSON.stringify(oauth, null, 2));
      console.log('💾 Successfully updated backend/config/googleSheetsOAuth.json!');
    } else {
      oauth.accessToken = body.access_token;
      fs.writeFileSync(OAUTH_PATH, JSON.stringify(oauth, null, 2));
      console.log('💾 Stored active access token in googleSheetsOAuth.json.');
    }
  } catch (err) {
    console.error('❌ Network or execution error:', err.message);
  }
}

main();
