import { NextResponse } from 'next/server'
import { runCustomCode } from '@/lib/custom-code-executor'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { code, rawData } = body

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { success: false, error: '코드를 입력하세요.' },
        { status: 400 }
      )
    }

    if (!rawData || typeof rawData !== 'string') {
      return NextResponse.json(
        { success: false, error: '테스트할 원시 데이터가 없습니다.' },
        { status: 400 }
      )
    }

    const result = runCustomCode(code, rawData)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to test custom code:', error)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
