import type { SystemStatus } from "@/types"

export function getStatusBadgeClass(status: SystemStatus, isEnabled: boolean): string {
  if (!isEnabled) return "bg-neutral-800 text-neutral-500"

  switch (status) {
    case "normal":
      return "bg-[#4ade80] text-white hover:bg-[#4ade80]/90"
    case "warning":
      return "bg-[#facc15] text-black hover:bg-[#facc15]/90"
    case "critical":
      return "bg-[#f87171] text-white hover:bg-[#f87171]/90"
    case "offline":
      return "bg-[#facc15] text-black hover:bg-[#facc15]/90"
    default:
      return ""
  }
}

export function getStatusLabel(status: SystemStatus, isEnabled: boolean): string {
  if (!isEnabled) return "비활성"

  switch (status) {
    case "normal":
      return "정상"
    case "warning":
      return "오프라인"
    case "critical":
      return "경고"
    case "offline":
      return "오프라인"
    default:
      return "오프라인"
  }
}

export function getTypeLabel(type: string): string {
  switch (type) {
    case "equipment":
      return "장비상태"
    case "ups":
      return "UPS"
    case "sensor":
      return "온습도"
    case "radar":
      return "레이더"
    case "fms":
      return "FMS"
    case "lcms":
      return "LCMS"
    case "vdl":
      return "VDL"
    case "marc":
      return "MARC"
    case "transmission":
      return "전송로"
    default:
      return type
  }
}
