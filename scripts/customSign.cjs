'use strict';

/**
 * Custom signing script for electron-builder using DigiCert Software Trust Manager.
 * Uses smctl CLI to sign Windows executables with EV code signing certificate.
 *
 * Signs all executables that electron-builder passes through the hook, except the
 * temp __uninstaller.exe created by NSIS during build. This ensures the main app exe,
 * helper executables, and the final installer are all signed — required by Windows
 * Smart App Control which checks the signature of the running exe, not just the installer.
 *
 * Required environment variables:
 * - SM_KEYPAIR_ALIAS: The keypair alias from DigiCert (e.g., key_1504094077)
 *
 * The following must be configured before signing (via smctl credentials or env vars):
 * - SM_HOST: DigiCert API endpoint (https://clientauth.one.nl.digicert.com)
 * - SM_API_KEY: API token from DigiCert ONE
 * - SM_CLIENT_CERT_FILE: Path to client authentication certificate (.p12)
 * - SM_CLIENT_CERT_PASSWORD: Password for the client certificate
 */

const path = require('path');

exports.default = async function (configuration) {
  if (!configuration.path) {
    console.log('No file path provided, skipping signing');
    return;
  }

  const filename = path.basename(configuration.path).toLowerCase();

  // Skip the temp uninstaller that electron-builder 26.x creates during NSIS build.
  // It's a transient file that gets embedded inside the installer and doesn't need signing.
  if (filename.includes('__uninstaller')) {
    console.log(`Skipping DigiCert signing for: ${filename} (temp uninstaller)`);
    return;
  }

  const { execSync } = require('child_process');
  const fs = require('fs');
  const keypairAlias = process.env.SM_KEYPAIR_ALIAS;

  if (!keypairAlias) {
    throw new Error('SM_KEYPAIR_ALIAS environment variable not set');
  }

  // Resolve smctl: use PATH first, fall back to known install location
  const SMCTL_INSTALL_DIR = 'C:\\Program Files\\DigiCert\\DigiCert One Signing Manager Tools';
  let smctl = 'smctl';
  try {
    execSync('smctl --version', { stdio: 'ignore' });
  } catch {
    const fullPath = path.join(SMCTL_INSTALL_DIR, 'smctl.exe');
    if (fs.existsSync(fullPath)) {
      smctl = `"${fullPath}"`;
    } else {
      throw new Error(`smctl not found on PATH or at ${fullPath}`);
    }
  }

  console.log(`Signing with DigiCert: ${configuration.path}`);

  const filePath = String(configuration.path);
  const signCmd = `${smctl} sign --keypair-alias="${keypairAlias}" --timestamp --input "${filePath}"`;

  // Capture stdout+stderr together — smctl can exit 0 while printing "FAILED"
  let signOutput = '';
  try {
    signOutput = execSync(`${signCmd} 2>&1`, { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`smctl sign command failed for ${filePath}:\n${error.stdout || error.message}`);
  }

  console.log(signOutput);

  if (signOutput.includes('FAILED')) {
    throw new Error(`smctl reported signing failure for ${filePath}:\n${signOutput}`);
  }

  // Verify the file is actually signed using signtool (belt-and-suspenders)
  try {
    execSync(`signtool verify /pa "${filePath}"`, { encoding: 'utf8' });
  } catch {
    throw new Error(
      `Signature verification failed for ${filePath} — file is not signed. ` +
      `Check DigiCert credentials (SM_HOST, SM_API_KEY, SM_CLIENT_CERT_FILE, SM_CLIENT_CERT_PASSWORD).`
    );
  }

  console.log(`Successfully signed and verified: ${filePath}`);
};
