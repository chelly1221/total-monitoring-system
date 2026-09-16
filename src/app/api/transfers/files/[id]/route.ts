import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { locateStagedFile } from '@/lib/transfers'

export const dynamic = 'force-dynamic'

/** Serve a staged file to the client that received the `transfer` command. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const file = /^[0-9a-f]{16}$/.test(id) ? await locateStagedFile(id) : null
  if (!file) {
    return NextResponse.json({ error: '파일이 없습니다' }, { status: 404 })
  }
  const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-File-Sha256': file.sha256,
      'Cache-Control': 'no-store',
    },
  })
}
