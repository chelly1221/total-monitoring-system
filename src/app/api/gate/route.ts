import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import net from 'net'
import dgram from 'dgram'

const TIMEOUT_MS = 5000

async function sendTcp(ip: string, port: number, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    socket.setTimeout(TIMEOUT_MS)

    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('연결 시간 초과'))
    })

    socket.on('error', (err) => {
      socket.destroy()
      reject(err)
    })

    socket.connect(port, ip, () => {
      socket.write(data, () => {
        socket.end()
        resolve()
      })
    })
  })
}

async function sendUdp(ip: string, port: number, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    const buffer = Buffer.from(data)

    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('전송 시간 초과'))
    }, TIMEOUT_MS)

    socket.send(buffer, port, ip, (err) => {
      clearTimeout(timeout)
      socket.close()
      if (err) reject(err)
      else resolve()
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST() {
  try {
    const settings = await prisma.setting.findMany({
      where: {
        key: { in: ['gateIp', 'gatePort', 'gateProtocol'] }
      }
    })

    const settingsMap = settings.reduce((acc, s) => {
      acc[s.key] = s.value
      return acc
    }, {} as Record<string, string>)

    const ip = settingsMap.gateIp || '192.168.1.150'
    const port = parseInt(settingsMap.gatePort || '6722')
    const protocol = settingsMap.gateProtocol || 'tcp'

    const send = protocol === 'udp' ? sendUdp : sendTcp

    // Send "11" twice
    await send(ip, port, '11')
    await send(ip, port, '11')

    // Wait 1 second
    await delay(1000)

    // Send "21" twice
    await send(ip, port, '21')
    await send(ip, port, '21')

    return NextResponse.json({ success: true, message: '게이트 열림 명령 전송 완료' })
  } catch (error) {
    console.error('Gate control error:', error)
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json(
      { success: false, error: `게이트 제어 실패: ${message}` },
      { status: 500 }
    )
  }
}
