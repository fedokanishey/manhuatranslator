import { NextRequest, NextResponse } from 'next/server';
import { processUploadedImages } from '@/lib/pipeline/upload-handler';
import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/constants';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { success: false, error: 'Expected multipart/form-data' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const files: Array<{ name: string; buffer: Buffer; type: string }> = [];

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        const arrayBuffer = await value.arrayBuffer();
        files.push({
          name: value.name,
          buffer: Buffer.from(arrayBuffer),
          type: value.type,
        });
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No files uploaded' },
        { status: 400 }
      );
    }

    // Validate total size
    const totalSize = files.reduce((sum, f) => sum + f.buffer.length, 0);
    if (totalSize > MAX_UPLOAD_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Total upload size (${(totalSize / 1024 / 1024).toFixed(1)}MB) exceeds limit (${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB)`,
        },
        { status: 413 }
      );
    }

    console.log(`[API/Upload] Received ${files.length} files, total ${(totalSize / 1024 / 1024).toFixed(1)}MB`);

    // Process uploaded images
    const processedImages = await processUploadedImages(files);

    // Return image metadata for page-by-page translation
    const images = processedImages.map((img) => ({
      src: img.originalSrc,
      index: img.index,
      width: img.width,
      height: img.height,
      base64: img.base64,
    }));

    return NextResponse.json({
      success: true,
      title: `Uploaded Chapter (${processedImages.length} pages)`,
      contentType: 'image' as const,
      images,
      sourceUrl: 'upload://',
    });
  } catch (error) {
    console.error('[API/Upload] Upload error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      },
      { status: 500 }
    );
  }
}
