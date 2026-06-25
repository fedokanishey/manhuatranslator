import { z } from 'zod';
import { BLOCKED_IP_RANGES, BLOCKED_PROTOCOLS } from './constants';

const urlSchema = z.string().url('Please enter a valid URL').refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'Only HTTP and HTTPS URLs are supported' }
);

export function validateUrl(url: string): { valid: boolean; error?: string; sanitized?: string } {
  const result = urlSchema.safeParse(url.trim());
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message || 'Invalid URL' };
  }

  const sanitized = result.data;
  
  try {
    const parsed = new URL(sanitized);

    // Block dangerous protocols
    if (BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
      return { valid: false, error: `Protocol "${parsed.protocol}" is not allowed` };
    }

    // Check hostname against blocked patterns
    const hostname = parsed.hostname.toLowerCase();
    const isBlocked = BLOCKED_IP_RANGES.some((pattern) => pattern.test(hostname));
    if (isBlocked) {
      return { valid: false, error: 'This URL points to a restricted address' };
    }

    return { valid: true, sanitized };
  } catch {
    return { valid: false, error: 'Failed to parse URL' };
  }
}

// In-memory rate limiter
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  ip: string,
  windowMs: number,
  maxRequests: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    rateLimitStore.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore) {
    if (now > value.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000);

export function sanitizeHtml(html: string): string {
  // Remove script tags and event handlers
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}
