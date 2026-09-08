import { Prisma } from '@prisma/client'
import { isRecord, parsePort, validateSystemBody } from './system-validation'

function validRow(modelName: string, value: unknown, nested: string[] = []): boolean {
  if (!isRecord(value)) return false
  const model = Prisma.dmmf.datamodel.models.find(model => model.name === modelName)!
  for (const [key, fieldValue] of Object.entries(value)) {
    if (nested.includes(key)) continue
    const field = model.fields.find(field => field.name === key && field.kind === 'scalar')
    if (!field) return false
    if (fieldValue === null) {
      if (field.isRequired) return false
      continue
    }
    if (field.type === 'String' && typeof fieldValue !== 'string') return false
    if (field.type === 'Boolean' && typeof fieldValue !== 'boolean') return false
    if (field.type === 'Float' && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue))) return false
    if (field.type === 'Int' && (typeof fieldValue !== 'number' || !Number.isInteger(fieldValue))) return false
    if (field.type === 'DateTime' && (typeof fieldValue !== 'string' || !Number.isFinite(Date.parse(fieldValue)))) return false
  }
  return model.fields.every(field => field.kind !== 'scalar' || !field.isRequired ||
    (field.hasDefaultValue && field.type !== 'DateTime') || value[field.name] != null)
}

export function validateBackup(data: unknown): string | null {
  if (!isRecord(data) || data.version !== '1.0' || !Array.isArray(data.systems)) return '지원하지 않는 백업 형식입니다'
  for (const system of data.systems) {
    if (!validRow('System', system, ['metrics']) || !Array.isArray(system.metrics) ||
      system.metrics.some((metric: unknown) => !validRow('Metric', metric))) return '장비 또는 측정값 백업이 올바르지 않습니다'
    if (system.port != null && parsePort(system.port) === null) return '백업에 잘못된 포트가 있습니다'
    if (system.config) {
      try {
        const error = validateSystemBody({ config: JSON.parse(system.config) }, true)
        if (error) return error
      } catch { return '백업의 장비 설정 JSON이 올바르지 않습니다' }
    }
  }
  for (const [key, model] of [['settings', 'Setting'], ['sirens', 'Siren'], ['alarmLogs', 'AlarmLog']]) {
    const rows = data[key]
    if (rows !== undefined && (!Array.isArray(rows) || rows.some(row => !validRow(model, row)))) return `${key} 백업이 올바르지 않습니다`
  }
  return null
}
