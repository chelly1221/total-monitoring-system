import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { findDownload, locateDownload } from '@/lib/downloads'

export const dynamic = 'force-dynamic'

/** Stream one client program as an attachment. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const item = findDownload(id)
  if (!item) {
    return NextResponse.json({ error: '알 수 없는 다운로드 항목입니다' }, { status: 404 })
  }
  const located = await locateDownload(item)
  if (!located) {
    return NextResponse.json({ error: `${item.name} 파일이 서버에 없습니다` }, { status: 404 })
  }

  const stream = Readable.toWeb(createReadStream(located.filePath)) as ReadableStream
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(located.size),
      'Content-Disposition': `attachment; filename="${item.file}"; filename*=UTF-8''${encodeURIComponent(item.file)}`,
      'Cache-Control': 'no-store',
    },
  })
}
