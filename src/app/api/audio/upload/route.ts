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
    const buffer = Buffer.from(await file.arrayBuffer())
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
