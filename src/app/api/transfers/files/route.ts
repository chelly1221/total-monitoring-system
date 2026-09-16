import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { MAX_TRANSFER_FILE_BYTES, publicFileInfo, sanitizeFileName, stageFile } from '@/lib/transfers'

export const dynamic = 'force-dynamic'

/**
 * Upload the file to transfer. The body is the raw file (not multipart) so it
 * streams to disk without being buffered; the name travels in the query string.
 */
export async function POST(request: NextRequest) {
  const name = sanitizeFileName(request.nextUrl.searchParams.get('name'))
  if (!name) {
    return NextResponse.json({ error: '파일 이름이 올바르지 않습니다' }, { status: 400 })
  }
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_TRANSFER_FILE_BYTES) {
    return NextResponse.json({ error: '파일이 너무 큽니다 (최대 2GB)' }, { status: 413 })
  }
  if (!request.body) {
    return NextResponse.json({ error: '파일 내용이 없습니다' }, { status: 400 })
  }
  try {
    const staged = await stageFile(name, Readable.fromWeb(request.body as import('stream/web').ReadableStream))
    return NextResponse.json({ file: publicFileInfo(staged) })
  } catch (error) {
    const message = error instanceof Error ? error.message : '파일을 저장하지 못했습니다'
    console.error('Transfer upload failed:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
