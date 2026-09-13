'use client'

import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import './settings.css'

const sections = [
  { id: 'features', title: '기능 표시', description: '화면·버튼 표시와 뇌전감시' },
  { id: 'gate', title: '게이트 연결', description: 'IP 주소·포트·프로토콜' },
  { id: 'sirens', title: '알람 사이렌', description: '장비 등록·사용·테스트' },
  { id: 'data', title: '데이터 관리', description: '이력 보관·백업·복원' },
] as const

type SectionId = typeof sections[number]['id']

export function SettingsWorkspace({ features, gate, sirens, data }: Record<SectionId, ReactNode>) {
  const [active, setActive] = useState<SectionId>('features')
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const panels = { features, gate, sirens, data }

  return (
    <div className="settings-focus flex h-full min-h-0 flex-col gap-5">
      <header className="shrink-0">
        <h1 className="text-[36px] font-bold leading-tight">설정</h1>
        <p className="mt-2 text-[20px] text-muted-foreground">항목을 선택해 감시 기능과 장비 연결을 설정합니다.</p>
      </header>
      <div className="flex min-h-0 flex-1 gap-8 border-t border-border pt-5">
        <nav role="tablist" aria-label="설정 항목" aria-orientation="vertical" className="flex w-[300px] shrink-0 flex-col gap-2">
          {sections.map((section, index) => (
            <button
              key={section.id}
              ref={element => { tabs.current[index] = element }}
              type="button"
              role="tab"
              id={`settings-tab-${section.id}`}
              aria-controls={`settings-panel-${section.id}`}
              aria-selected={active === section.id}
              tabIndex={active === section.id ? 0 : -1}
              onClick={() => setActive(section.id)}
              onKeyDown={event => {
                if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + sections.length) % sections.length
                setActive(sections[next].id)
                tabs.current[next]?.focus()
              }}
              className={cn(
                'rounded-md px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
                active === section.id ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
              )}
            >
              <span className="block whitespace-nowrap text-[24px] font-semibold">{section.title}</span>
              <span className={cn('mt-1 block text-[18px]', active === section.id ? 'text-neutral-700' : 'text-muted-foreground')}>
                {section.description}
              </span>
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 pb-4">
          {sections.map(section => (
            <div
              key={section.id}
              role="tabpanel"
              id={`settings-panel-${section.id}`}
              aria-labelledby={`settings-tab-${section.id}`}
              hidden={active !== section.id}
              tabIndex={0}
              className="mx-auto max-w-[1200px] focus-visible:outline-2 focus-visible:outline-ring"
            >
              {panels[section.id]}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
