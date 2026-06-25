import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CACHE_TTL_MS } from './constants';

const CACHE_DIR = process.env.VERCEL
  ? path.join('/tmp', 'translations')
  : path.join(process.cwd(), '.cache', 'translations');

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function getCachePath(key: string): string {
  return path.join(CACHE_DIR, `${hashKey(key)}.json`);
}

export function getCached<T>(key: string): T | null {
  try {
    ensureCacheDir();
    const filePath = getCachePath(key);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(raw) as { data: T; timestamp: number };

    // Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, data: T): void {
  try {
    ensureCacheDir();
    const filePath = getCachePath(key);
    const entry = { data, timestamp: Date.now() };
    fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
  } catch (error) {
    console.error('[Cache] Failed to write:', error);
  }
}

export function clearExpiredCache(): number {
  try {
    ensureCacheDir();
    const files = fs.readdirSync(CACHE_DIR);
    let cleared = 0;

    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const entry = JSON.parse(raw) as { timestamp: number };
        if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
          fs.unlinkSync(filePath);
          cleared++;
        }
      } catch {
        // Remove corrupted cache files
        fs.unlinkSync(filePath);
        cleared++;
      }
    }

    return cleared;
  } catch {
    return 0;
  }
}
