import type { ReactNode } from 'react'
import './settings.css'

type SectionId = 'features' | 'audio' | 'gate' | 'sirens' | 'data'

export function SettingsWorkspace({ features, audio, gate, sirens, data }: Record<SectionId, ReactNode>) {
  return (
    <div className="settings-overview">
      <header className="settings-page-header">
        <h1>설정</h1>
        <p>감시 기능과 장비 연결, 데이터 보관을 관리합니다.</p>
      </header>
      <div className="settings-columns">
        <div className="settings-column settings-main-column">{features}{audio}</div>
        <div className="settings-column settings-main-column">{gate}{data}</div>
        <div className="settings-column settings-siren-column">{sirens}</div>
      </div>
      <p className="settings-page-footer">설정 변경은 자동 저장됩니다. 연결 정보는 입력을 마치면 저장됩니다.</p>
    </div>
  )
}
