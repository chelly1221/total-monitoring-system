import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { audioDirectories } from '@/lib/audio-storage'

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
  if (sanitized !== filename || /[\\/:\x00]/.test(filename)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const ext = path.extname(sanitized).toLowerCase()
  const contentType = MIME_TYPES[ext]
  if (!contentType) {
    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 })
  }

  const { writable, bundled } = audioDirectories()

  try {
    const buffer = await readFile(path.join(writable, sanitized)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' || writable === bundled) throw error
      return readFile(path.join(bundled, sanitized))
    })
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
