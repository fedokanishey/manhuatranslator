import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runTranslationPipeline } from '@/lib/pipeline/orchestrator';
import { checkRateLimit } from '@/lib/security';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from '@/lib/constants';

export const maxDuration = 60; // Max execution timeout for Vercel Hobby

const requestSchema = z.object({
  url: z.string().url('Please provide a valid URL'),
  targetLang: z.string().min(2).max(5).optional().default('ar'),
  full: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';
    
    const rateLimit = checkRateLimit(ip, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Too many requests. Please wait a moment before trying again.',
          retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
        },
        { 
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    // Parse & validate body
    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: parseResult.error.issues[0]?.message || 'Invalid request',
        },
        { status: 400 }
      );
    }

    const { url, targetLang, full } = parseResult.data;

    // Run translation pipeline
    const result = await runTranslationPipeline(url, targetLang, full);

    return NextResponse.json(result, {
      status: result.success ? 200 : 422,
      headers: {
        'X-Rate-Limit-Remaining': String(rateLimit.remaining),
      },
    });
  } catch (error) {
    console.error('[API] Translation error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    service: 'MangaLens Translation API',
    version: '1.0.0',
    status: 'healthy',
    endpoints: {
      'POST /api/translate': {
        body: { url: 'string (required)', targetLang: 'string (optional, default: ar)' },
      },
    },
  });
}
