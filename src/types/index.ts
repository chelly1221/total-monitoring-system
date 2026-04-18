export type AudioAlertType = 'file' | 'none'

export interface AudioConfig {
  type: AudioAlertType
  fileName?: string  // file in /audio/ directory
}

export type SystemStatus = 'normal' | 'warning' | 'critical' | 'offline'

export type SystemType = 'equipment' | 'ups' | 'sensor'

export type AlarmSeverity = 'warning' | 'critical' | 'offline'

export type TrendDirection = 'up' | 'down' | 'stable'

export type MetricItemType = 'inputVoltage' | 'outputVoltage' | 'batteryVoltage' | 'inputCurrent' | 'outputCurrent' | 'batteryCurrent' | 'inputFrequency' | 'outputFrequency' | 'load' | 'temperature' | 'status' | 'batteryRemaining' | 'custom'

// Equipment config: pattern-based status detection
export interface EquipmentConfig {
  normalPatterns: string[]
  criticalPatterns: string[]
  matchMode: 'exact'
}

// Condition-based threshold types (for sensor)
export type ConditionOperator = 'between' | 'gte' | 'lte' | 'eq' | 'neq'

export interface ThresholdCondition {
  operator: ConditionOperator
  value1: number          // between: lower bound, gte/lte: threshold value
  value2: number | null   // between: upper bound, others: null
  stringValue?: string    // eq/neq: text-based comparison (status type)
}

export interface StatusConditions {
  normal: ThresholdCondition[]
  critical: ThresholdCondition[]
  coldCritical: ThresholdCondition[]  // cold warning (temperature only, critical level)
  dryCritical: ThresholdCondition[]   // dry warning (humidity only, critical level)
  humidCritical: ThresholdCondition[] // humid warning (humidity only, critical level)
}

export type DataMatchOperator = 'contains' | 'startsWith' | 'endsWith' | 'equals' | 'regex'

export interface DataMatchCondition {
  operator: DataMatchOperator
  value: string
}

// Display item for UPS/sensor metrics
export interface DisplayItem {
  name: string
  index: number
  unit: string
  itemType?: MetricItemType
  warning: number | null       // UPS: 하한치 (lower limit), alarm if value <= this
  critical: number | null      // UPS: 상한치 (upper limit), alarm if value >= this
  chartEnabled?: boolean       // DEPRECATED, kept for backward compat read
  chartGroup?: string | null   // UPS: free-form chart group name (e.g. '입력전압', 'R상', '배터리') | null
  alarmEnabled?: boolean       // UPS: enable alarm for this metric (default true)
  conditions?: StatusConditions  // sensor condition mode (if present, use conditions instead of warning/critical)
  audioConfig?: AudioConfig      // per-item audio alert (sensor only)
  dataMatchConditions?: DataMatchCondition[]  // data matching filter (sensor only)
}

// UPS/Sensor config: delimiter-based parsing with multiple metrics
export interface MetricsConfig {
  delimiter: string
  displayItems: DisplayItem[]
  customCode?: string
}

// Union type for system config
export type SystemConfig = EquipmentConfig | MetricsConfig

export interface System {
  id: string
  name: string
  type: SystemType
  status: SystemStatus
  isActive: boolean
  isEnabled: boolean
  port: number | null
  protocol: string | null
  lastDataAt: Date | null
  config: string | null
  audioConfig: string | null
  createdAt: Date
  updatedAt: Date
  metrics?: Metric[]
  alarms?: Alarm[]
}

export interface Metric {
  id: string
  systemId: string
  name: string
  value: number
  textValue?: string | null
  unit: string
  min: number | null
  max: number | null
  warningThreshold: number | null
  criticalThreshold: number | null
  trend: TrendDirection | null
  createdAt: Date
  updatedAt: Date
}

export interface Alarm {
  id: string
  systemId: string
  severity: AlarmSeverity
  message: string
  value: string | null
  acknowledged: boolean
  acknowledgedAt: Date | null
  acknowledgedBy: string | null
  createdAt: Date
  resolvedAt: Date | null
  system?: System
}

export interface AlarmLog {
  id: string
  systemId: string
  systemName: string
  severity: AlarmSeverity
  message: string
  value: string | null
  createdAt: Date
}

export interface Setting {
  id: string
  key: string
  value: string
  category: string | null
  createdAt: Date
  updatedAt: Date
}

export interface SystemWithMetrics extends System {
  metrics: Metric[]
}

export interface SystemWithAlarms extends System {
  alarms: Alarm[]
}

// Prisma-compatible types (string-based for database compatibility)
export interface PrismaSystem {
  id: string
  name: string
  type: string
  status: string
  isActive: boolean
  isEnabled: boolean
  port: number | null
  protocol: string | null
  lastDataAt: Date | null
  config: string | null
  audioConfig: string | null
  createdAt: Date
  updatedAt: Date
  metrics?: PrismaMetric[]
  alarms?: PrismaAlarm[]
}

export interface PrismaMetric {
  id: string
  systemId: string
  name: string
  value: number
  textValue?: string | null
  unit: string
  min: number | null
  max: number | null
  warningThreshold: number | null
  criticalThreshold: number | null
  trend: string | null
  createdAt: Date
  updatedAt: Date
}

export interface PrismaAlarm {
  id: string
  systemId: string
  severity: string
  message: string
  value: string | null
  acknowledged: boolean
  acknowledgedAt: Date | null
  acknowledgedBy: string | null
  createdAt: Date
  resolvedAt: Date | null
  system?: PrismaSystem
}

// WebSocket message types
export type WebSocketMessageType = 'metric' | 'alarm' | 'alarm-resolved' | 'system' | 'init' | 'ping' | 'delete' | 'raw' | 'siren-sync' | 'settings'

export interface WebSocketMessage {
  type: WebSocketMessageType
  data: {
    systemId?: string
    systemName?: string
    status?: SystemStatus
    // For metrics
    metricId?: string
    metricName?: string
    value?: number
    textValue?: string | null
    unit?: string
    trend?: TrendDirection | null
    // For alarms
    alarmId?: string
    alarmIds?: string[]
    severity?: AlarmSeverity
    message?: string
    alarmValue?: string | null
    acknowledged?: boolean
    bulk?: boolean
    // For raw data preview
    port?: number
    rawData?: string
    // For settings sync
    audioEnabled?: string
    muteEndTime?: string
    temperatureEnabled?: string
    upsEnabled?: string
    gateEnabled?: string
  }
  timestamp: string
}

export interface RealtimeState {
  systems: Map<string, System>
  metrics: Map<string, Metric>
  alarms: Alarm[]
  connected: boolean
  lastUpdate: Date | null
}

// Helper to parse config from JSON string
export function parseSystemConfig(configJson: string | null, type: SystemType): SystemConfig | null {
  if (!configJson) return null
  try {
    const parsed = JSON.parse(configJson)
    if (type === 'equipment') {
      return parsed as EquipmentConfig
    } else {
      return parsed as MetricsConfig
    }
  } catch {
    return null
  }
}

// Type guards
export function isEquipmentConfig(config: SystemConfig): config is EquipmentConfig {
  return 'normalPatterns' in config && 'criticalPatterns' in config && !('delimiter' in config)
}

export function isMetricsConfig(config: SystemConfig): config is MetricsConfig {
  return ('delimiter' in config || 'customCode' in config) && 'displayItems' in config
}
