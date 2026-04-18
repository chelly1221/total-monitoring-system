import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav']

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
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

    const buffer = Buffer.from(await file.arrayBuffer())

    // Magic bytes validation
    const isWav = buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    const isMp3Id3 = buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33
    const isMp3Sync = buffer.length >= 2 && buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0
    if (!isWav && !isMp3Id3 && !isMp3Sync) {
      return NextResponse.json(
        { error: '유효한 MP3 또는 WAV 파일이 아닙니다' },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: '파일 크기는 5MB 이하여야 합니다' },
        { status: 400 }
      )
    }

    // Sanitize filename
    const ext = path.extname(file.name).toLowerCase()
    const baseName = path.basename(file.name, ext)
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
      .substring(0, 50)
    const fileName = `${Date.now()}-${baseName}${ext}`

    const audioDir = path.join(process.cwd(), 'public', 'audio')
    await mkdir(audioDir, { recursive: true })

    const filePath = path.join(audioDir, fileName)
    await writeFile(filePath, buffer)

    return NextResponse.json({
      fileName,
      url: `/audio/${fileName}`,
    })
  } catch (error) {
    console.error('Audio upload error:', error)
    return NextResponse.json(
      { error: '파일 업로드에 실패했습니다' },
      { status: 500 }
    )
  }
}
