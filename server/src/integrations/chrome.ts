import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** Uses the Chrome or Edge already installed on this machine; no browser download needed. */
export function findChrome(configured?: string): string | null {
  if (configured) return fs.existsSync(configured) ? configured : null;
  const local = process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')] : [];
  return [...CANDIDATES, ...local].find((p) => fs.existsSync(p)) ?? null;
}
