"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"]

interface CalendarCell {
  y: number
  m: number
  d: number
  outside: boolean
}

interface CalendarProps {
  selected?: string // 'YYYY-MM-DD'
  onSelect: (date: string) => void
  className?: string
}

function pad(n: number) {
  return String(n).padStart(2, "0")
}

function toDateString(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

function parseDateString(value?: string): { y: number; m: number; d: number } | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

function buildCells(viewYear: number, viewMonth: number): CalendarCell[] {
  const startOffset = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate()

  const cells: CalendarCell[] = []

  for (let i = startOffset - 1; i >= 0; i--) {
    const prevMonthDate = new Date(viewYear, viewMonth, 0)
    cells.push({
      y: prevMonthDate.getFullYear(),
      m: prevMonthDate.getMonth(),
      d: daysInPrevMonth - i,
      outside: true,
    })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ y: viewYear, m: viewMonth, d, outside: false })
  }
  let cursor = 1
  while (cells.length < 42) {
    const nextMonthDate = new Date(viewYear, viewMonth + 1, cursor)
    cells.push({
      y: nextMonthDate.getFullYear(),
      m: nextMonthDate.getMonth(),
      d: nextMonthDate.getDate(),
      outside: true,
    })
    cursor++
  }
  return cells
}

function Calendar({ selected, onSelect, className }: CalendarProps) {
  const today = new Date()
  const selectedDate = parseDateString(selected)

  const [viewYear, setViewYear] = React.useState(selectedDate?.y ?? today.getFullYear())
  const [viewMonth, setViewMonth] = React.useState(selectedDate?.m ?? today.getMonth())
  const [viewMode, setViewMode] = React.useState<"days" | "years">("days")

  const cells = React.useMemo(() => buildCells(viewYear, viewMonth), [viewYear, viewMonth])
  const decadeStart = Math.floor(viewYear / 12) * 12
  const yearBlock = React.useMemo(
    () => Array.from({ length: 12 }, (_, i) => decadeStart + i),
    [decadeStart]
  )

  function goToPrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((y) => y - 1)
    } else {
      setViewMonth((m) => m - 1)
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((y) => y + 1)
    } else {
      setViewMonth((m) => m + 1)
    }
  }

  function goToToday() {
    setViewMode("days")
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
    onSelect(toDateString(today.getFullYear(), today.getMonth(), today.getDate()))
  }

  return (
    <div className={cn("w-fit select-none", className)} data-slot="calendar">
      {viewMode === "days" ? (
        <>
          <div className="mb-2 flex items-center justify-between gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={goToPrevMonth}
              aria-label="이전 달"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-sm font-medium"
              onClick={() => setViewMode("years")}
            >
              {viewYear}년 {viewMonth + 1}월
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={goToNextMonth}
              aria-label="다음 달"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="flex h-8 items-center justify-center text-xs font-medium text-muted-foreground"
              >
                {w}
              </div>
            ))}
            {cells.map(({ y, m, d, outside }) => {
              const value = toDateString(y, m, d)
              const isSelected = selected === value
              const isToday =
                y === today.getFullYear() && m === today.getMonth() && d === today.getDate()

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onSelect(value)}
                  data-selected={isSelected || undefined}
                  data-today={isToday || undefined}
                  data-outside={outside || undefined}
                  className={cn(
                    "flex size-8 cursor-pointer items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    outside && "text-muted-foreground/40",
                    isToday && !isSelected && "border border-ring/60 font-semibold text-accent-blue",
                    isSelected && "bg-primary text-primary-foreground font-semibold hover:bg-primary/90"
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex justify-center border-t border-border pt-2">
            <Button type="button" variant="ghost" size="xs" onClick={goToToday}>
              오늘
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewYear((y) => y - 12)}
              aria-label="이전 연대"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="text-sm font-medium">
              {decadeStart}년 - {decadeStart + 11}년
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewYear((y) => y + 12)}
              aria-label="다음 연대"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {yearBlock.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => {
                  setViewYear(y)
                  setViewMode("days")
                }}
                className={cn(
                  "flex h-9 cursor-pointer items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  y === viewYear && "bg-primary text-primary-foreground font-semibold hover:bg-primary/90",
                  y === today.getFullYear() && y !== viewYear && "font-semibold text-accent-blue"
                )}
              >
                {y}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export { Calendar }
