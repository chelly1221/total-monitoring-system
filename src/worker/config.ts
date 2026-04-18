// Port configuration for UDP and TCP data collectors

export interface PortConfig {
  system: string
  type: 'sensor' | 'alarm' | 'ups' | 'vdl' | 'marc' | 'lcms' | 'fms' | 'transmission'
  encoding?: 'utf8' | 'buffer'
  description?: string
}

export const UDP_PORTS: Record<number, PortConfig> = {
  1884: { system: '관제송신소 장비실', type: 'sensor', description: 'Temperature/Humidity sensor' },
  1891: { system: 'MARC', type: 'marc', description: 'MARC 시스템' },
  1892: { system: '관제송신소 UPS', type: 'ups', description: '관제송신소 UPS' },
  1893: { system: '1레이더 LCMS', type: 'lcms', description: '1레이더 LCMS' },
  1894: { system: '1레이더 FMS', type: 'fms', description: '1레이더 FMS' },
  1895: { system: '2레이더 LCMS', type: 'lcms', description: '2레이더 LCMS' },
  1896: { system: '2레이더 FMS', type: 'fms', description: '2레이더 FMS' },
  1897: { system: '1레이더 UPS', type: 'ups', description: '1레이더 UPS' },
  1898: { system: '1레이더 전송로', type: 'transmission', description: '1레이더 전송로' },
  5555: { system: '경항공기 통신실 UPS', type: 'ups', encoding: 'utf8', description: '경항공기 통신실 UPS' },
  1990: { system: 'UPS-1레이더-2', type: 'ups', encoding: 'utf8', description: 'Radar 1 UPS #2' },
  1991: { system: 'UPS-1레이더-2-aux', type: 'ups', encoding: 'utf8', description: 'Radar 1 UPS #2 auxiliary' },
}

export const TCP_PORTS: Record<number, PortConfig> = {
  1884: { system: '관제송신소 장비실', type: 'sensor', description: 'Temperature/Humidity sensor (TCP alternative)' },
  1886: { system: 'VDL', type: 'vdl', description: 'VDL system' },
}
