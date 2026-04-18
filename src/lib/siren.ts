import net from 'net'
import dgram from 'dgram'

const TIMEOUT_MS = 5000

export async function sendTcp(ip: string, port: number, data: string): Promise<void> {
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

export async function sendUdp(ip: string, port: number, data: string): Promise<void> {
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
