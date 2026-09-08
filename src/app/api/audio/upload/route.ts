import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { audioDirectories } from '@/lib/audio-storage'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav']

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: '파일이 필요합니다' },
        { status: 400 }
      )
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'MP3 또는 WAV 파일만 허용됩니다' },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: '파일 크기는 5MB 이하여야 합니다' }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())

    // Magic bytes validation
    const isWav = buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE'
    const isMp3Id3 = buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33
    const isMp3Sync = buffer.length >= 2 && buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0
    if (!isWav && !isMp3Id3 && !isMp3Sync) {
      return NextResponse.json(
        { error: '유효한 MP3 또는 WAV 파일이 아닙니다' },
        { status: 400 }
      )
    }

    // Sanitize filename
    const ext = isWav ? '.wav' : '.mp3'
    const baseName = path.basename(file.name, path.extname(file.name))
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
      .substring(0, 50)
    const fileName = `${randomUUID()}-${baseName}${ext}`

    const audioDir = audioDirectories().writable
    await mkdir(audioDir, { recursive: true })

    const filePath = path.join(audioDir, fileName)
    await writeFile(filePath, buffer)

    return NextResponse.json({
      fileName,
      url: `/api/audio/${fileName}`,
    })
  } catch (error) {
    console.error('Audio upload error:', error)
    return NextResponse.json(
      { error: '파일 업로드에 실패했습니다' },
      { status: 500 }
    )
  }
}
