import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Complete first-use onboarding through its real controls before legacy workflows.
export async function dismissTutorial(page) {
  await page.waitForFunction(() => document.querySelector('#tutorial-dialog')?.open || document.querySelector('#library-dialog')?.open || document.querySelector('#open-tutorial')?.disabled === false);
  if (await page.locator('#tutorial-dialog').evaluate(dialog => dialog.open)) {
    await page.locator('#tutorial-never').check();
    await page.locator('#tutorial-skip').click();
    await page.locator('#tutorial-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('#open-tutorial').disabled);
  }
}

// Operate the real dialogs and tabs rather than clicking through hidden controls.
export async function openLibrary(page) {
  await dismissTutorial(page);
  if (!await page.locator('#library-dialog').evaluate(dialog => dialog.open)) await page.locator('#library-toggle').click();
  await page.locator('#library-dialog').waitFor({ state: 'visible' });
}
export async function closeLibrary(page) {
  await dismissTutorial(page);
  if (await page.locator('#library-dialog').evaluate(dialog => dialog.open)) await page.locator('#close-library').click();
}
export async function openImport(page) {
  await openLibrary(page);
  if (!await page.locator('#import-panel').evaluate(details => details.open)) await page.locator('#import-panel > summary').click();
}
export async function openMoves(page) {
  await closeLibrary(page);
  if (!await page.locator('#moves-panel').isVisible()) await page.locator('#moves-tab').click();
}
export async function openEngine(page) {
  await openMoves(page);
  if (!await page.locator('#engine-panel').evaluate(details => details.open)) await page.locator('#engine-panel > summary').click();
}
export async function openSummary(page) {
  await closeLibrary(page);
  if (!await page.locator('#summary-panel').isVisible()) await page.locator('#summary-tab').click();
}
// Close only the generated test profile if Windows leaves a crash reporter holding its pipe.
export async function closeTestContext(context, profile, prefix) {
  const temporaryRoot = resolve(tmpdir());
  const safeProfile = typeof profile === 'string' && /^meowlchess-[a-z-]+-$/.test(prefix) && dirname(profile) === temporaryRoot && basename(profile).startsWith(prefix);
  if (!context) return;
  const closing = context.close();
  let timer;
  const closed = await Promise.race([closing.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
  clearTimeout(timer);
  if (!closed && process.platform === 'win32' && safeProfile) {
    const literalProfile = profile.replaceAll("'", "''");
    const command = `$testProfile = '${literalProfile}'
$profilePattern = [regex]::Escape($testProfile) + '(?:["\\s]|$)'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(brave|msedge|chrome|chromium)\\.exe$' -and $_.CommandLine -and $_.CommandLine -match $profilePattern } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { timeout: 10000, windowsHide: true });
  }
  await closing;
  if (safeProfile) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
