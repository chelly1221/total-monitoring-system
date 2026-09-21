import type { ReactNode } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlarmCard } from '@/components/cards/alarm-card'
import { SystemDataPreview } from './system-data-preview'
import { UpsDataPreview } from './ups-data-preview'
import type { DataMatchCondition } from '@/types'
import './device-editor.css'

export function DeviceEditor({
  header,
  connection,
  settings,
  preview,
  error,
  creating = false,
}: {
  header: ReactNode
  connection: ReactNode
  settings: ReactNode
  preview: ReactNode
  error?: string | null
  creating?: boolean
}) {
  return (
    <div className="device-editor">
      {header}
      {error && (
        <div className="device-editor-error" role="alert">
          {error}
        </div>
      )}
      <div className="device-editor-columns">
        <div
          className="device-editor-column"
          aria-label="기본 정보와 통신 설정"
        >
          {connection}
        </div>
        <div className="device-editor-column" aria-label="감시와 알람 설정">
          {settings}
        </div>
        <div className="device-editor-column" aria-label="수신 데이터와 이력">
          {preview}
        </div>
      </div>
      <p className="device-editor-footer">
        {creating
          ? '장비를 등록하기 전까지 서버에 적용되지 않습니다.'
          : '설정 변경은 저장한 뒤 적용됩니다.'}
      </p>
    </div>
  )
}

export function DeviceSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="device-section">
      <header>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  )
}

export function DeviceAdvanced({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <details className="device-advanced">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  )
}

export function DeviceNewHeader({
  typeName,
  saving,
  onBack,
}: {
  typeName: string
  saving: boolean
  onBack: () => void
}) {
  return (
    <header className="device-editor-header">
      <div className="device-editor-heading">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="목록으로"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div>
          <h1>새 {typeName} 장비 추가</h1>
          <p>통신 정보와 알람 기준을 설정하고 장비를 등록합니다.</p>
        </div>
      </div>
      <div className="device-editor-actions">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={saving}
        >
          취소
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {saving ? '등록 중' : '장비 등록'}
        </Button>
      </div>
    </header>
  )
}

interface DeviceConnectionFieldsProps {
  name: string
  port: string
  protocol: 'udp' | 'tcp' | 'mqtt'
  topic: string
  encoding: 'buffer' | 'utf8'
  offlineThresholdMin: string
  disabled?: boolean
  onNameChange: (value: string) => void
  onPortChange: (value: string) => void
  onProtocolChange: (value: 'udp' | 'tcp' | 'mqtt') => void
  onTopicChange: (value: string) => void
  onEncodingChange: (value: 'buffer' | 'utf8') => void
  onOfflineThresholdChange: (value: string) => void
  systemType?: 'equipment' | 'sensor'
  onSystemTypeChange?: (value: 'equipment' | 'sensor') => void
}

export function DeviceConnectionFields(props: DeviceConnectionFieldsProps) {
  const { disabled = false } = props
  return (
    <DeviceSection
      title="기본 정보 · 통신"
      description="장비 식별 정보와 서버 수신 방식을 설정합니다."
    >
      <div className="device-fields">
        <label className="device-field device-field-full" htmlFor="name">
          <span>장비 이름</span>
          <Input
            id="name"
            value={props.name}
            onChange={(e) => props.onNameChange(e.target.value)}
            placeholder="예: 장비실 감시 장비"
            disabled={disabled}
            required
          />
        </label>
        {props.onSystemTypeChange && (
          <label
            className="device-field device-field-full"
            htmlFor="device-type"
          >
            <span>장비 유형</span>
            <select
              id="device-type"
              value={props.systemType}
              onChange={(e) =>
                props.onSystemTypeChange?.(
                  e.target.value as 'equipment' | 'sensor'
                )
              }
              disabled={disabled}
            >
              <option value="equipment">장비상태</option>
              <option value="sensor">온습도</option>
            </select>
          </label>
        )}
        <label className="device-field" htmlFor="protocol">
          <span>프로토콜</span>
          <select
            id="protocol"
            value={props.protocol}
            onChange={(e) =>
              props.onProtocolChange(e.target.value as 'udp' | 'tcp' | 'mqtt')
            }
            disabled={disabled}
          >
            <option value="udp">UDP</option>
            <option value="tcp">TCP</option>
            <option value="mqtt">MQTT</option>
          </select>
        </label>
        {props.protocol !== 'mqtt' && (
          <label className="device-field" htmlFor="port">
            <span>수신 포트</span>
            <Input
              id="port"
              type="number"
              min={1}
              max={65535}
              value={props.port}
              onChange={(e) => props.onPortChange(e.target.value)}
              placeholder="예: 6101"
              disabled={disabled}
              required
            />
          </label>
        )}
        <label className="device-field" htmlFor="encoding">
          <span>데이터 인코딩</span>
          <select
            id="encoding"
            value={props.encoding}
            onChange={(e) =>
              props.onEncodingChange(e.target.value as 'buffer' | 'utf8')
            }
            disabled={disabled}
          >
            <option value="buffer">20바이트</option>
            <option value="utf8">UTF-8</option>
          </select>
        </label>
        <label className="device-field" htmlFor="offline-threshold">
          <span>오프라인 판정 (분)</span>
          <Input
            id="offline-threshold"
            type="number"
            min={1}
            value={props.offlineThresholdMin}
            onChange={(e) => props.onOfflineThresholdChange(e.target.value)}
            placeholder="기본값"
            disabled={disabled}
          />
        </label>
        {props.protocol === 'mqtt' && (
          <label className="device-field device-field-full" htmlFor="topic">
            <span>MQTT 토픽</span>
            <Input
              id="topic"
              value={props.topic}
              onChange={(e) => props.onTopicChange(e.target.value)}
              placeholder="facility/sensors"
              disabled={disabled}
              required
            />
          </label>
        )}
      </div>
      <p className="device-help">
        설정한 시간 동안 데이터가 없으면 오프라인으로 판정합니다. 비워 두면 서버
        기본값을 사용합니다.
      </p>
    </DeviceSection>
  )
}

interface DeviceAlarm {
  id: string
  severity: string
  message: string
  value?: string | null
  createdAt: string
  acknowledged: boolean
  acknowledgedAt: string | null
  system: { id: string; name: string }
}

export function DeviceAlarmLog({
  alarms,
  onAcknowledge,
}: {
  alarms: DeviceAlarm[]
  onAcknowledge: (id: string) => void
}) {
  return (
    <DeviceSection
      title="최근 알람"
      description="현재 장비의 알람과 처리 상태입니다."
    >
      <div className="device-alarm-list">
        {alarms.length ? (
          alarms.map((alarm) => (
            <AlarmCard
              key={alarm.id}
              alarm={{ ...alarm, createdAt: new Date(alarm.createdAt) }}
              onAcknowledge={onAcknowledge}
              showSystemName={false}
              compact
            />
          ))
        ) : (
          <p className="device-empty">알람 기록이 없습니다.</p>
        )}
      </div>
    </DeviceSection>
  )
}

export function DeviceDataPreview({
  kind,
  port,
  connected,
  messages,
  metrics = [],
  getConditionsForItem,
}: {
  kind: 'equipment' | 'sensor' | 'ups'
  port: string
  connected: boolean
  messages: string[]
  metrics?: {
    name: string
    value: number
    unit: string
    textValue?: string | null
  }[]
  getConditionsForItem?: (name: string) => DataMatchCondition[] | undefined
}) {
  const Preview = kind === 'ups' ? UpsDataPreview : SystemDataPreview
  return (
    <DeviceSection
      title="데이터 미리보기"
      description={kind === 'equipment'
        ? '수신한 원문을 확인합니다.'
        : '수신한 원문과 현재 측정값을 확인합니다.'}
    >
      {kind !== 'equipment' && metrics.length > 0 && (
        <div className="device-readings">
          {metrics.slice(0, 4).map((metric, index) => (
            <div key={`${metric.name}-${index}`}>
              <span>{metric.name}</span>
              <strong>
                {metric.textValue ??
                  (Number.isFinite(metric.value)
                    ? Number(metric.value.toFixed(2))
                    : '—')}
                <small>{metric.unit}</small>
              </strong>
            </div>
          ))}
        </div>
      )}
      {kind === 'sensor' ? (
        ['온도', '습도'].map((label) => (
          <div className="device-preview-block" key={label}>
            <Preview
              port={port}
              connected={connected}
              messages={messages}
              label={label}
              dataMatchConditions={getConditionsForItem?.(label)}
              className="device-raw-preview"
            />
          </div>
        ))
      ) : (
        <Preview
          port={port}
          connected={connected}
          messages={messages}
          className="device-raw-preview"
        />
      )}
    </DeviceSection>
  )
}
