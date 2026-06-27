import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { processSinglePage } from '@/lib/pipeline/orchestrator';

export const maxDuration = 60; // Allow Vercel functions to run up to 60s

const requestSchema = z.object({
  imageUrl: z.string().min(1, 'Please provide an image URL or upload reference'),
  index: z.number().int().nonnegative(),
  targetLang: z.string().min(2).max(5).optional().default('ar'),
  langs: z.array(z.string()).optional(),
  /** Base64 image data for uploaded images */
  imageBase64: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
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

    const { imageUrl, index, targetLang, langs, imageBase64 } = parseResult.data;

    // Run single-page translation pipeline
    const pageResult = await processSinglePage(imageUrl, index, targetLang, langs, imageBase64);

    return NextResponse.json({
      success: true,
      page: pageResult,
    });
  } catch (error) {
    console.error('[API] Page translation error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
