import { ArrowLeft, Loader2, X, Check } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { UpsActions } from "@/components/forms/ups-actions"
import { getStatusBadgeClass, getStatusLabel, getTypeLabel } from "@/lib/system-display-utils"
import type { SystemStatus, PrismaSystem } from "@/types"

interface UpsDetailHeaderProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  system: any
  displayName: string
  displayPort: string
  displayProtocol: string
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
    <div className="flex items-center justify-between shrink-0 pb-1.5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <h1 className="text-lg font-bold">{displayName}</h1>
        <span className="text-xs text-muted-foreground">
          {getTypeLabel(system.type)}
          {displayPort && (
            <> | 포트:{displayPort} ({displayProtocol.toUpperCase()})</>
          )}
        </span>
        <Badge className={`text-[10px] px-1.5 py-0 ${getStatusBadgeClass(status, isEnabled)}`}>
          {getStatusLabel(status, isEnabled)}
        </Badge>
      </div>
      <div className="flex gap-2">
        {isEditMode ? (
          <>
            {/* 취소 버튼 (아이콘만) */}
            <Button
              variant="outline"
              size="icon"
              onClick={onCancel}
              disabled={saving}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>

            {/* 저장 버튼 (아이콘만) */}
            <Button
              size="icon"
              onClick={onSave}
              disabled={saving}
              className="h-8 w-8"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
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
