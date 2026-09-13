export function gateSettingsError(settings: Record<string, unknown>): string | null {
  if ('gateIp' in settings) {
    const octets = typeof settings.gateIp === 'string' ? settings.gateIp.split('.') : []
    if (octets.length !== 4 || octets.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) {
      return '올바른 IP 주소를 입력하세요.'
    }
  }
  if ('gatePort' in settings &&
    (!['string', 'number'].includes(typeof settings.gatePort) || !/^\d+$/.test(String(settings.gatePort)) || Number(settings.gatePort) < 1 || Number(settings.gatePort) > 65535)) {
    return '포트는 1~65535 사이의 정수로 입력하세요.'
  }
  if ('gateProtocol' in settings && settings.gateProtocol !== 'tcp' && settings.gateProtocol !== 'udp') {
    return 'TCP 또는 UDP를 선택하세요.'
  }
  return null
}
