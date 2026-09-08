import { isIP } from 'node:net'
import { isRecord, parsePort } from './system-validation'

export function validateSirenBody(body: unknown, partial = false): string | null {
  if (!isRecord(body)) return '잘못된 요청 형식입니다'
  if ((!partial || 'ip' in body) && (typeof body.ip !== 'string' || !isIP(body.ip))) return '유효한 IP 주소를 입력해주세요'
  if ((!partial || 'port' in body) && parsePort(body.port) === null) return '포트 번호는 1~65535 사이의 정수여야 합니다'
  if ('protocol' in body && !['tcp', 'udp'].includes(String(body.protocol))) return '프로토콜은 tcp 또는 udp여야 합니다'
  if ('isEnabled' in body && typeof body.isEnabled !== 'boolean') return '사용 여부가 올바르지 않습니다'
  for (const [key, max] of [['messageOn', 1000], ['messageOff', 1000], ['location', 100]] as const) {
    if ((!partial && key !== 'messageOff') || key in body) {
      if (typeof body[key] !== 'string' || body[key].length > max || (key !== 'messageOff' && !body[key].trim())) return '메시지와 위치를 확인해주세요'
    }
  }
  return null
}
