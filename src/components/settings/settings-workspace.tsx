import type { ReactNode } from 'react'
import './settings.css'

type SectionId = 'features' | 'gate' | 'sirens' | 'data'

export function SettingsWorkspace({ features, gate, sirens, data }: Record<SectionId, ReactNode>) {
  return (
    <div className="settings-overview">
      <header className="settings-page-header">
        <h1>설정</h1>
        <p>감시 기능과 장비 연결, 데이터 보관을 관리합니다.</p>
      </header>
      <div className="settings-columns">
        <div className="settings-column settings-main-column">{features}{gate}{data}</div>
        <div className="settings-column settings-siren-column">{sirens}</div>
      </div>
      <p className="settings-page-footer">기능 표시와 사이렌 사용 여부는 즉시 저장 · 연결·용량은 버튼으로 저장</p>
    </div>
  )
}
