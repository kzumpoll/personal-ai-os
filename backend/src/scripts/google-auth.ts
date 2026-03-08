/**
 * One-time OAuth2 setup script for Google Calendar.
 *
 * Usage:
 *   npx tsx src/scripts/google-auth.ts
 *
 * Requires:
 *   GOOGLE_CREDENTIALS_PATH in .env pointing to the downloaded credentials.json
 *   GOOGLE_TOKEN_PATH in .env — where the output token will be saved
 */
import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

async function main() {
  const credPath = process.env.GOOGLE_CREDENTIALS_PATH;
  const tokenPath = process.env.GOOGLE_TOKEN_PATH;

  if (!credPath || !tokenPath) {
    console.error('Set GOOGLE_CREDENTIALS_PATH and GOOGLE_TOKEN_PATH in .env');
    process.exit(1);
  }
  if (!fs.existsSync(credPath)) {
    console.error(`Credentials file not found: ${credPath}`);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed ?? credentials.web;
  const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const url = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log('\nOpen this URL in your browser:\n');
  console.log(url);
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Paste the authorization code here: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await auth.getToken(code.trim());
      fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
      console.log(`\nToken saved to: ${tokenPath}`);
      console.log('Google Calendar is now configured.');
    } catch (err) {
      console.error('Failed to exchange token:', err);
      process.exit(1);
    }
  });
}

main();
