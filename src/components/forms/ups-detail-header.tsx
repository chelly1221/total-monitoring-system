import { ArrowLeft, Loader2, X, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UpsActions } from '@/components/forms/ups-actions'
import {
  getStatusBadgeClass,
  getStatusLabel,
  getTypeLabel,
} from '@/lib/system-display-utils'
import type { SystemStatus, PrismaSystem } from '@/types'

interface UpsDetailHeaderProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  system: any
  displayName: string
  displayPort: string
  displayProtocol: string
  displayTopic?: string
  status: SystemStatus
  isEnabled: boolean
  isEditMode: boolean
  saving: boolean
  onBack: () => void
  onSave: () => void
  onCancel: () => void
  onEditClick: () => void
  onEnabledChange: (enabled: boolean) => void
}

export function UpsDetailHeader({
  system,
  displayName,
  displayPort,
  displayProtocol,
  displayTopic,
  status,
  isEnabled,
  isEditMode,
  saving,
  onBack,
  onSave,
  onCancel,
  onEditClick,
  onEnabledChange,
}: UpsDetailHeaderProps) {
  return (
    <div className="device-editor-header">
      <div className="device-editor-heading">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="목록으로"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div>
          <h1>{displayName}</h1>
          <p>
            {getTypeLabel(system.type)}
            {displayProtocol === 'mqtt'
              ? displayTopic && <> | 토픽:{displayTopic} (MQTT)</>
              : displayPort && (
                  <>
                    {' '}
                    | 포트:{displayPort} ({displayProtocol.toUpperCase()})
                  </>
                )}
          </p>
        </div>
        <Badge
          className={`text-[10px] px-1.5 py-0 ${getStatusBadgeClass(status, isEnabled)}`}
        >
          {getStatusLabel(status, isEnabled)}
        </Badge>
      </div>
      <div className="device-editor-actions">
        {isEditMode ? (
          <>
            <Button variant="outline" onClick={onCancel} disabled={saving}>
              <X className="h-4 w-4" />
              취소
            </Button>
            <Button onClick={onSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {saving ? '저장 중' : '변경 저장'}
            </Button>
          </>
        ) : (
          <UpsActions
            system={system as unknown as PrismaSystem}
            onEnabledChange={onEnabledChange}
            onEditClick={onEditClick}
          />
        )}
      </div>
    </div>
  )
}
