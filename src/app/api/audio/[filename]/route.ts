import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  // Prevent path traversal
  const sanitized = path.basename(filename)
  if (sanitized !== filename) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const ext = path.extname(sanitized).toLowerCase()
  const contentType = MIME_TYPES[ext]
  if (!contentType) {
    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 })
  }

  const filePath = path.join(process.cwd(), 'public', 'audio', sanitized)

  try {
    const buffer = await readFile(filePath)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
