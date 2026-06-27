/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { validateUrl } from '../security';

import { FETCH_TIMEOUT_MS, USER_AGENT } from '../constants';
import type { FetchError, FetchErrorType } from '@/types/translation';

export interface FetchResult {
  html: string;
  finalUrl: string;
  contentType: string;
  statusCode: number;
}

export interface FetchWithFallbackResult {
  result?: FetchResult;
  error?: FetchError;
  strategy: 'fetch' | 'playwright' | 'failed';
}

// ── Cloudflare / Anti-Bot Detection ──────────────────────────────────

const CLOUDFLARE_PATTERNS = [
  'cf-browser-verification',
  'cf_clearance',
  'challenge-platform',
  'Just a moment...',
  'Checking your browser',
  'ray ID',
  'Attention Required',
  'Cloudflare',
  'DDoS protection by',
  '_cf_chl',
  'Verify you are human',
];

function detectAntiBot(html: string, statusCode: number, headers?: Headers): FetchErrorType | null {
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 503 || statusCode === 429) {
    // Check if it's a Cloudflare challenge
    const isCloudflare = CLOUDFLARE_PATTERNS.some((p) => html.includes(p));
    if (isCloudflare) return 'cloudflare';
    return 'forbidden';
  }

  // Check response content for challenge pages even with 200 status
  if (statusCode === 200) {
    const isChallenge = CLOUDFLARE_PATTERNS.some((p) => html.includes(p));
    if (isChallenge && html.length < 5000) {
      return 'cloudflare';
    }
  }

  return null;
}

function createFetchError(type: FetchErrorType, originalMessage: string): FetchError {
  const messages: Record<FetchErrorType, { message: string; suggestion: string }> = {
    cloudflare: {
      message: 'This website is protected by Cloudflare and blocks automated access.',
      suggestion: 'Please upload chapter images directly using the upload button below, or use the browser extension to translate directly on the website.',
    },
    forbidden: {
      message: 'This website blocks automated access (403 Forbidden).',
      suggestion: 'Please upload chapter images directly using the upload button below, or use the browser extension.',
    },
    timeout: {
      message: `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`,
      suggestion: 'The website may be slow or blocking requests. Try uploading images directly.',
    },
    network: {
      message: `Network error: ${originalMessage}`,
      suggestion: 'Check your internet connection and try again, or upload images directly.',
    },
    unknown: {
      message: originalMessage,
      suggestion: 'Try uploading chapter images directly using the upload button below.',
    },
  };

  const info = messages[type] || messages.unknown;
  return { type, message: info.message, suggestion: info.suggestion };
}

// ── Strategy 1: Standard Fetch ───────────────────────────────────────

export async function fetchPage(url: string): Promise<FetchResult> {
  const validation = validateUrl(url);
  if (!validation.valid) {
    throw new Error(`URL validation failed: ${validation.error}`);
  }

  const targetUrl = validation.sanitized!;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
      redirect: 'follow',
    });

    const html = await response.text();

    // Check for anti-bot before returning
    const antiBotType = detectAntiBot(html, response.status);
    if (antiBotType) {
      throw Object.assign(
        new Error(`Anti-bot detected: ${antiBotType}`),
        { fetchErrorType: antiBotType }
      );
    }

    if (!response.ok) {
      throw Object.assign(
        new Error(`HTTP ${response.status}: ${response.statusText}`),
        { fetchErrorType: response.status === 403 ? 'forbidden' as const : 'unknown' as const }
      );
    }

    const contentType = response.headers.get('content-type') || 'text/html';

    return {
      html,
      finalUrl: response.url,
      contentType,
      statusCode: response.status,
    };
  } catch (error: any) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw Object.assign(
        new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`),
        { fetchErrorType: 'timeout' as const }
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Strategy 2: Playwright Headless Browser ──────────────────────────

async function fetchWithPlaywright(url: string): Promise<FetchResult> {
  console.log('[Fetcher] Strategy 2: Attempting Playwright headless browser...');

  let playwright: any;
  try {
    const importPlaywright = new Function("return import('playwright')");
    playwright = await importPlaywright();
  } catch {
    throw new Error('Playwright is not installed. Install with: npm install playwright');
  }


  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // Navigate and wait for network idle (images loaded)
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: FETCH_TIMEOUT_MS * 2,
    });

    // Wait for images to finish loading
    await page.waitForTimeout(2000);

    const html = await page.content();
    const statusCode = response?.status() || 200;
    const finalUrl = page.url();

    await context.close();

    return {
      html,
      finalUrl,
      contentType: 'text/html',
      statusCode,
    };
  } finally {
    await browser.close();
  }
}

// ── Combined Fetch with Fallback ─────────────────────────────────────

export async function fetchWithFallback(url: string): Promise<FetchWithFallbackResult> {
  // Strategy 1: Standard fetch
  try {
    console.log('[Fetcher] Strategy 1: Standard fetch...');
    const result = await fetchPage(url);
    return { result, strategy: 'fetch' };
  } catch (error: any) {
    const errorType: FetchErrorType = error.fetchErrorType || 'unknown';
    console.warn(`[Fetcher] Strategy 1 failed (${errorType}):`, error.message);

    // If it's a validation error, don't try other strategies
    if (error.message.includes('URL validation failed')) {
      return {
        error: createFetchError('unknown', error.message),
        strategy: 'failed',
      };
    }

    // Strategy 2: Playwright headless browser
    try {
      const result = await fetchWithPlaywright(url);
      return { result, strategy: 'playwright' };
    } catch (playwrightError: any) {
      console.warn('[Fetcher] Strategy 2 (Playwright) failed:', playwrightError.message);

      // Both strategies failed — return structured error
      return {
        error: createFetchError(errorType, error.message),
        strategy: 'failed',
      };
    }
  }
}

// ── Image Fetch ──────────────────────────────────────────────────────

export async function fetchImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': new URL(url).origin,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}
