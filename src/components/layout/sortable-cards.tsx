'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from 'react'
import { Grip, Check, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { moveCard, nearestCardSlot } from '@/lib/card-order'
import './sortable-cards.css'

interface DragState {
  id: string
  target: string
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  x: number
  y: number
  moved: boolean
  keyboard: boolean
}

interface SortContext {
  editing: boolean
  drag: DragState | null
  start: (id: string, event: PointerEvent<HTMLButtonElement>) => void
  move: (event: PointerEvent<HTMLButtonElement>) => void
  finish: (cancel?: boolean) => void
  key: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void
}
const SortContext = createContext<SortContext | null>(null)

export function CardLayoutControls({ editing, onEditingChange, onReset, compact = false }: {
  editing: boolean; onEditingChange: (editing: boolean) => void; onReset: () => void; compact?: boolean
}) {
  return (
    <div className={cn('flex items-center gap-2', compact && 'flex-wrap pb-2')}>
      {editing && <Button variant="ghost" size="sm" onClick={onReset} title="이 화면의 카드 순서를 처음 배치로 되돌립니다"><RotateCcw />기본 순서</Button>}
      <Button variant={editing ? 'default' : 'outline'} size="sm" aria-pressed={editing} onClick={() => onEditingChange(!editing)}>
        {editing ? <Check /> : <Grip />}{editing ? '배치 완료' : '배치 변경'}
      </Button>
    </div>
  )
}

export function SortableGroup({ ids, editing, onReorder, label, className, children }: {
  ids: string[]; editing: boolean; onReorder: (ids: string[]) => void; label: string; className?: string; children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [message, setMessage] = useState('')
  const frame = useRef<number | null>(null)
  const pointer = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const cancel = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('blur', cancel)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])

  function update(next: DragState | null) { dragRef.current = next; setDrag(next) }
  function stopScroll() {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }
  function finish(cancel = false) {
    stopScroll()
    const current = dragRef.current
    if (current && !cancel && current.moved && ids.includes(current.id) && ids.includes(current.target)) {
      onReorder(moveCard(ids, current.id, current.target))
      setMessage(`${ids.indexOf(current.target) + 1}번째 위치로 이동했습니다. 순서가 자동 저장됩니다.`)
      // UPS cards can change column parents, so restore keyboard focus after reconciliation.
      if (current.keyboard) requestAnimationFrame(() => {
        const item = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-sort-id]') ?? []).find(element => element.dataset.sortId === current.id)
        item?.querySelector<HTMLButtonElement>('.sortable-handle')?.focus()
      })
    } else if (current) { setMessage('이동을 취소했습니다.') }
    update(null)
  }
  function trackPointer(x: number, y: number) {
    const current = dragRef.current
    if (!current || !root.current) return
    const bounds = root.current.getBoundingClientRect()
    const inside = x >= bounds.left - 24 && x <= bounds.right + 24 && y >= bounds.top - 24 && y <= bounds.bottom + 24
    const slots = Array.from(root.current.querySelectorAll<HTMLElement>('[data-sort-id]')).map(element => {
      const rect = element.getBoundingClientRect()
      return { id: element.dataset.sortId!, left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    })
    const origin = slots.find(slot => slot.id === current.id)
    if (!origin) { finish(true); return }
    update({ ...current, x: x - origin.left - current.offsetX, y: y - origin.top - current.offsetY,
      target: inside ? nearestCardSlot(slots, x, y) ?? current.id : current.id,
      moved: current.moved || Math.hypot(x - current.startX, y - current.startY) > 6 })
  }
  function autoScroll() {
    if (!root.current || !dragRef.current) { stopScroll(); return }
    // Scroll the existing list viewport, keeping the surrounding dashboard fixed.
    let container: HTMLElement | null = root.current
    while (container && container.scrollHeight <= container.clientHeight + 1) container = container.parentElement
    if (container && /(auto|scroll)/.test(getComputedStyle(container).overflowY)) {
      const rect = container.getBoundingClientRect()
      const { x, y } = pointer.current
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const delta = y < rect.top + 36 ? -10 : y > rect.bottom - 36 ? 10 : 0
        if (delta) { container.scrollTop += delta; trackPointer(x, y) }
      }
    }
    frame.current = requestAnimationFrame(autoScroll)
  }
  const context: SortContext = {
    editing, drag,
    start(id, event) {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      event.currentTarget.setPointerCapture(event.pointerId)
      pointer.current = { x: event.clientX, y: event.clientY }
      const rect = event.currentTarget.getBoundingClientRect()
      update({ id, target: id, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, x: 0, y: 0, moved: false, keyboard: false })
      stopScroll()
      frame.current = requestAnimationFrame(autoScroll)
    },
    move(event) {
      if (!dragRef.current || dragRef.current.keyboard) return
      pointer.current = { x: event.clientX, y: event.clientY }
      trackPointer(event.clientX, event.clientY)
    },
    finish,
    key(id, event) {
      if (![' ', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const current = dragRef.current
      if (event.key === 'Escape') { finish(true); return }
      if (event.key === ' ' || event.key === 'Enter') {
        if (current) finish()
        else { update({ id, target: id, startX: 0, startY: 0, offsetX: 0, offsetY: 0, x: 0, y: 0, moved: false, keyboard: true }); setMessage('방향키로 위치를 선택하고 Enter로 놓으세요. Escape로 취소합니다.') }
      } else if (current?.keyboard) {
        const index = ids.indexOf(current.target)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1)))
        update({ ...current, target: ids[next], moved: true })
        setMessage(`${next + 1}번째 위치. Enter로 놓으세요.`)
      }
    },
  }
  return (
    <SortContext.Provider value={context}>
      <div ref={root} className={cn('sortable-group', className)} aria-label={label}>
        {children}
      </div>
      <span className="sr-only" role="status">{message}</span>
    </SortContext.Provider>
  )
}

export function SortableCard({ id, label, className, children }: { id: string; label: string; className?: string; children: ReactNode }) {
  const context = useContext(SortContext)
  if (!context) throw new Error('SortableCard requires SortableGroup')
  const { editing, drag } = context
  const active = drag?.id === id
  const target = drag?.target === id && drag.id !== id
  return (
    <div data-sort-id={id} className={cn('sortable-slot', editing && 'sortable-editing', target && 'sortable-target', className)}>
      <div inert={editing} className={cn('sortable-content', active && 'sortable-active')} style={active && !drag.keyboard ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : undefined}>
        {children}
      </div>
      {editing && <button type="button" className="sortable-handle" aria-label={`${label} 순서 이동`} aria-pressed={active}
        title="드래그해서 순서 변경 · 키보드: Enter → 방향키 → Enter · 취소: Escape"
        onPointerDown={event => context.start(id, event)} onPointerMove={context.move}
        onPointerUp={() => context.finish()} onPointerCancel={() => context.finish(true)} onLostPointerCapture={() => { if (active && !drag.keyboard) context.finish(true) }}
        onBlur={() => { if (active && drag.keyboard) context.finish(true) }}
        onKeyDown={event => context.key(id, event)} onClick={event => event.stopPropagation()}>
        <span className="sortable-grip"><Grip size={16} />{target ? '여기에 놓기' : '이동'}</span>
      </button>}
    </div>
  )
}
