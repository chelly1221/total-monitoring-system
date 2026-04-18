'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { Filter, RotateCcw } from 'lucide-react'

interface SystemOption {
  id: string
  name: string
  type: string
}

const TYPE_ORDER = ['equipment', 'sensor', 'ups'] as const

const TYPE_LABELS: Record<string, string> = {
  equipment: '장비',
  sensor: '온습도',
  ups: 'UPS',
}

type TypeFilter = 'all' | 'critical' | 'warning' | 'hot' | 'cold' | 'dry' | 'humid'

interface AlarmFilterPanelProps {
  typeFilter: TypeFilter
  onTypeChange: (value: TypeFilter) => void
  systems: SystemOption[]
  selectedSystems: Set<string>
  onSelectedSystemsChange: (systems: Set<string>) => void
  dateFrom: string
  timeFrom: string
  dateTo: string
  timeTo: string
  onDateFromChange: (value: string) => void
  onTimeFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  onTimeToChange: (value: string) => void
  temperatureEnabled?: boolean
}

export function AlarmFilterPanel({
  typeFilter,
  onTypeChange,
  systems,
  selectedSystems,
  onSelectedSystemsChange,
  dateFrom,
  timeFrom,
  dateTo,
  timeTo,
  onDateFromChange,
  onTimeFromChange,
  onDateToChange,
  onTimeToChange,
  temperatureEnabled = true,
}: AlarmFilterPanelProps) {
  const grouped = systems.reduce<Record<string, SystemOption[]>>((groups, system) => {
    const group = system.type || 'other'
    if (!groups[group]) groups[group] = []
    groups[group].push(system)
    return groups
  }, {})

  const allSelected = systems.length > 0 && systems.every((s) => selectedSystems.has(s.id))

  function handleSelectAll() {
    onSelectedSystemsChange(new Set(systems.map((s) => s.id)))
  }

  function handleDeselectAll() {
    onSelectedSystemsChange(new Set())
  }

  function handleToggleSystem(id: string) {
    const next = new Set(selectedSystems)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onSelectedSystemsChange(next)
  }

  function handleResetDates() {
    onDateFromChange('')
    onTimeFromChange('00:00')
    onDateToChange('')
    onTimeToChange('23:59')
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Filter className="h-4 w-4" />
          필터
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 space-y-6 overflow-auto">
        {/* Date range filter */}
        <div className="flex items-center gap-2 mb-0 w-fit">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="text-sm"
          />
          <Input
            type="text"
            placeholder="00:00"
            value={timeFrom}
            onChange={(e) => onTimeFromChange(e.target.value)}
            className="text-sm w-[4.5rem] shrink-0"
          />
          <span className="text-muted-foreground text-sm shrink-0">~</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="text-sm"
          />
          <Input
            type="text"
            placeholder="23:59"
            value={timeTo}
            onChange={(e) => onTimeToChange(e.target.value)}
            className="text-sm w-[4.5rem] shrink-0"
          />
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="xs" onClick={handleResetDates} className="gap-1 text-muted-foreground shrink-0">
              <RotateCcw className="h-3 w-3" />
              초기화
            </Button>
          )}
        </div>

        {/* Type filter */}
        <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
          {([
            { key: 'all', label: '전체', active: '', inactive: '' },
            { key: 'critical', label: '심각', active: 'bg-[#ef4444] text-white border-[#ef4444]', inactive: '' },
            { key: 'warning', label: '오프라인', active: 'bg-[#eab308] text-black border-[#eab308]', inactive: '' },
            { key: 'hot', label: '고온', active: 'bg-red-600 text-white border-red-600', inactive: '' },
            { key: 'cold', label: '저온', active: 'bg-blue-500 text-white border-blue-500', inactive: '' },
            { key: 'dry', label: '건조', active: 'bg-orange-500 text-white border-orange-500', inactive: '' },
            { key: 'humid', label: '다습', active: 'bg-cyan-500 text-white border-cyan-500', inactive: '' },
          ] as const).filter(({ key }) => {
            if (!temperatureEnabled && (key === 'hot' || key === 'cold' || key === 'dry' || key === 'humid')) return false
            return true
          }).map(({ key, label, active }) => (
            <button
              key={key}
              onClick={() => onTypeChange(key as TypeFilter)}
              className={cn(
                'rounded-full px-3 py-0.5 text-xs font-medium border cursor-pointer transition-colors',
                typeFilter === key
                  ? (active || 'bg-white text-black border-white')
                  : 'bg-transparent text-muted-foreground border-border hover:border-muted-foreground/50'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* System filter */}
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">시스템</h4>
          <div className="flex gap-2 mb-3">
            <Button variant="outline" size="xs" onClick={handleSelectAll} disabled={allSelected}>
              전체 선택
            </Button>
            <Button variant="outline" size="xs" onClick={handleDeselectAll} disabled={selectedSystems.size === 0}>
              전체 해제
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-x-6">
            {TYPE_ORDER.map((type) => {
              const groupSystems = grouped[type]
              if (!groupSystems || groupSystems.length === 0) return null
              return (
                <div key={type}>
                  <h5 className="text-xs font-medium text-muted-foreground/70 mb-1.5">
                    {TYPE_LABELS[type] || type}
                  </h5>
                  <div className="space-y-1.5">
                    {groupSystems.map((system) => (
                      <label
                        key={system.id}
                        className="flex items-center gap-2 cursor-pointer text-sm"
                      >
                        <Checkbox
                          checked={selectedSystems.has(system.id)}
                          onCheckedChange={() => handleToggleSystem(system.id)}
                          className="border-zinc-500 data-[state=checked]:bg-black data-[state=checked]:border-black data-[state=checked]:text-white"
                        />
                        <span>{system.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </CardContent>
    </Card>
  )
}
