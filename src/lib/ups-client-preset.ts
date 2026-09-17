// Facility preset for a UPS fed by the 2026 1레이더 UPS client (ups-client/).
// The client forwards each SNMP poll as {"UPS": 1|2, "Data": {"입력 전압 R (V)": "374 V", ...}}
// (formatted strings, same wire format as the original snmpups program). This module
// turns that into a MetricsConfig: a custom parser plus one display item per reading
// with the client's default limits (= the 제1레이더 PC's original settings.json /
// ups2_settings.json). No Node imports: used by the browser forms and tests.

import type { DisplayItem, MetricItemType, MetricsConfig, StatusConditions } from '@/types'

export interface UpsClientItem {
  /** Metric name on the server (display item / Metric row). */
  name: string
  /** Key inside the client's `Data` object. */
  source: string
  unit: string
  itemType: MetricItemType
  /** Lower / upper limits (client defaults); null = no limit on that side. */
  min: number | null
  max: number | null
  chartGroup: string | null
  /** Textual status reading: alarm when the text is not 정상. */
  text?: boolean
}

const phase = (p: 'R' | 'S' | 'T'): UpsClientItem[] => [
  { name: `입력전압 ${p}`, source: `입력 전압 ${p} (V)`, unit: 'V', itemType: 'inputVoltage', min: 300, max: 700, chartGroup: '입력전압' },
  { name: `입력전류 ${p}`, source: `입력 전류 ${p} (A)`, unit: 'A', itemType: 'inputCurrent', min: null, max: 50, chartGroup: '입력전류' },
  { name: `입력전력 ${p}`, source: `입력 전력 ${p} (kW)`, unit: 'kW', itemType: 'custom', min: null, max: 100, chartGroup: '입력전력' },
  { name: `출력전압 ${p}`, source: `출력 전압 ${p} (V)`, unit: 'V', itemType: 'outputVoltage', min: 200, max: 250, chartGroup: '출력전압' },
  { name: `출력전류 ${p}`, source: `출력 전류 ${p} (A)`, unit: 'A', itemType: 'outputCurrent', min: null, max: 50, chartGroup: '출력전류' },
  { name: `부하 ${p}`, source: `출력 ${p} (%)`, unit: '%', itemType: 'load', min: null, max: 100, chartGroup: '부하' },
]

export const UPS_CLIENT_ITEMS: Record<1 | 2, UpsClientItem[]> = {
  1: [
    { name: '출력상태', source: '출력 상태', unit: '', itemType: 'status', min: null, max: null, chartGroup: null, text: true },
    { name: '배터리상태', source: '배터리 상태', unit: '', itemType: 'status', min: null, max: null, chartGroup: null, text: true },
    ...phase('R'), ...phase('S'), ...phase('T'),
    { name: '입력주파수', source: '입력 주파수 (Hz)', unit: 'Hz', itemType: 'inputFrequency', min: 50, max: 70, chartGroup: '주파수' },
    { name: '출력주파수', source: '출력 주파수(Hz)', unit: 'Hz', itemType: 'outputFrequency', min: 50, max: 70, chartGroup: '주파수' },
    { name: '배터리전압', source: '배터리 전압(V)', unit: 'V', itemType: 'batteryVoltage', min: 200, max: 500, chartGroup: '배터리' },
    { name: '배터리잔량', source: '배터리 잔량(%)', unit: '%', itemType: 'batteryRemaining', min: null, max: 100, chartGroup: '배터리' },
  ],
  2: [
    { name: '출력상태', source: '출력 상태', unit: '', itemType: 'status', min: null, max: null, chartGroup: null, text: true },
    { name: '배터리상태', source: '배터리 상태', unit: '', itemType: 'status', min: null, max: null, chartGroup: null, text: true },
    { name: '입력전압', source: '입력 전압 (V)', unit: 'V', itemType: 'inputVoltage', min: 180, max: 450, chartGroup: '전압' },
    { name: '출력전압', source: '출력 전압 (V)', unit: 'V', itemType: 'outputVoltage', min: 180, max: 450, chartGroup: '전압' },
    { name: '입력주파수', source: '입력 주파수 (Hz)', unit: 'Hz', itemType: 'inputFrequency', min: 50, max: 70, chartGroup: '주파수' },
    { name: '출력주파수', source: '출력 주파수 (Hz)', unit: 'Hz', itemType: 'outputFrequency', min: 50, max: 70, chartGroup: '주파수' },
    { name: '배터리전압', source: '배터리 전압 (V)', unit: 'V', itemType: 'batteryVoltage', min: null, max: 290, chartGroup: '배터리' },
    { name: '배터리잔량', source: '배터리 잔량 (%)', unit: '%', itemType: 'batteryRemaining', min: null, max: 100, chartGroup: '배터리' },
    { name: '배터리온도', source: '배터리 온도 (°C)', unit: '°C', itemType: 'temperature', min: null, max: 60, chartGroup: '배터리' },
  ],
}

export function upsClientUnit(value: unknown): 1 | 2 {
  return value === 2 || value === '2' ? 2 : 1
}

const STATUS_CONDITIONS: StatusConditions = {
  normal: [],
  critical: [{ operator: 'neq', value1: 0, value2: null, stringValue: '정상' }],
  coldCritical: [],
  dryCritical: [],
  humidCritical: [],
}

/** Display items for one UPS card, with the client's default limits as thresholds. */
export function buildUpsClientDisplayItems(unit: 1 | 2): DisplayItem[] {
  return UPS_CLIENT_ITEMS[unit].map((item, index) => ({
    name: item.name,
    index,
    unit: item.unit,
    itemType: item.itemType,
    // Server semantics: alarm when value <= warning or >= critical, so a 0 lower bound
    // (idle current, empty battery reading) must stay open instead of alarming at 0.
    warning: item.text ? null : item.min,
    critical: item.text ? null : item.max,
    alarmEnabled: true,
    chartGroup: item.chartGroup,
    ...(item.text ? { conditions: STATUS_CONDITIONS } : {}),
  }))
}

/**
 * Custom parser (function body; `raw` is the datagram). Numbers come out of the
 * client's formatted strings ("374 V" -> 374), status texts pass through unchanged.
 * Datagrams of the other UPS card yield an empty object.
 */
export function buildUpsClientCustomCode(unit: 1 | 2): string {
  const map = Object.fromEntries(UPS_CLIENT_ITEMS[unit].filter(i => !i.text).map(i => [i.name, i.source]))
  const texts = Object.fromEntries(UPS_CLIENT_ITEMS[unit].filter(i => i.text).map(i => [i.name, i.source]))
  return [
    `// 2026 1레이더 UPS 클라이언트 (UPS#${unit}) 수신 데이터 파싱 — 자동 생성`,
    'const msg = JSON.parse(raw);',
    `if (!msg || msg.UPS !== ${unit} || typeof msg.Data !== 'object' || msg.Data === null) return {};`,
    'const d = msg.Data;',
    `const numbers = ${JSON.stringify(map)};`,
    `const texts = ${JSON.stringify(texts)};`,
    'const out = {};',
    'for (const name in numbers) {',
    '  const v = d[numbers[name]];',
    '  if (typeof v !== \'string\' || v === \'No Data\') continue;',
    '  const n = parseFloat(v);',
    '  if (Number.isFinite(n)) out[name] = n;',
    '}',
    'for (const name in texts) {',
    '  const v = d[texts[name]];',
    '  if (typeof v === \'string\' && v !== \'No Data\') out[name] = v;',
    '}',
    'return out;',
  ].join('\n')
}

export function buildUpsClientPreset(unit: 1 | 2): Pick<MetricsConfig, 'delimiter' | 'displayItems' | 'customCode'> {
  return { delimiter: ',', displayItems: buildUpsClientDisplayItems(unit), customCode: buildUpsClientCustomCode(unit) }
}

/** True when the config already carries this preset's parser (so re-selecting keeps operator edits). */
export function isUpsClientPreset(config: Pick<MetricsConfig, 'customCode'>, unit: 1 | 2): boolean {
  return typeof config.customCode === 'string' && config.customCode.includes(`msg.UPS !== ${unit}`)
}
