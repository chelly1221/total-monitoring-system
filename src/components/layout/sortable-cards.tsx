'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from 'react'
import { Grip } from 'lucide-react'
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
  drag: DragState | null
  start: (id: string, event: PointerEvent<HTMLDivElement>) => void
  finish: (cancel?: boolean) => void
  key: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void
}
const SortContext = createContext<SortContext | null>(null)

export function SortableGroup({ ids, onReorder, label, className, children }: {
  ids: string[]; onReorder: (ids: string[]) => void; label: string; className?: string; children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [message, setMessage] = useState('')
  const frame = useRef<number | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const releaseGesture = useRef<(() => void) | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const cancel = () => {
      releaseGesture.current?.()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('blur', cancel)
      releaseGesture.current?.()
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
    releaseGesture.current?.()
    const current = dragRef.current
    if (!current) return
    const present = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-sort-id]') ?? []).map(element => element.dataset.sortId)
    if (!cancel && current.moved && current.target !== current.id && present.includes(current.id) && present.includes(current.target)) {
      onReorder(moveCard(ids, current.id, current.target))
      setMessage(`${ids.indexOf(current.target) + 1}번째 위치로 이동했습니다. 순서가 자동 저장됩니다.`)
      // UPS cards can change column parents, so restore keyboard focus after reconciliation.
      if (current.keyboard) requestAnimationFrame(() => {
        const item = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-sort-id]') ?? []).find(element => element.dataset.sortId === current.id)
        item?.querySelector<HTMLButtonElement>('.sortable-handle')?.focus()
      })
    } else if (current.moved || current.keyboard) { setMessage('이동을 취소했습니다.') }
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
    drag,
    start(id, event) {
      if (event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest('input, select, textarea, [contenteditable="true"], [data-no-card-drag], button:not(.sortable-handle)')) return
      if (dragRef.current) finish(true)
      suppressClick.current = false
      const element = event.currentTarget
      const pointerId = event.pointerId
      pointer.current = { x: event.clientX, y: event.clientY }
      const rect = element.getBoundingClientRect()
      update({ id, target: id, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, x: 0, y: 0, moved: false, keyboard: false })
      // Keep the original click target until movement passes the drag threshold.
      // Window listeners also catch a fast first move outside a small card.
      const move = (next: globalThis.PointerEvent) => {
        if (next.pointerId !== pointerId || !dragRef.current) return
        const current = dragRef.current
        if (!current.moved && Math.hypot(next.clientX - current.startX, next.clientY - current.startY) <= 6) return
        if (!current.moved) {
          suppressClick.current = true
          element.setPointerCapture(pointerId)
          frame.current = requestAnimationFrame(autoScroll)
        }
        next.preventDefault()
        pointer.current = { x: next.clientX, y: next.clientY }
        trackPointer(next.clientX, next.clientY)
      }
      const end = (next: globalThis.PointerEvent) => {
        if (next.pointerId === pointerId) finish(next.type === 'pointercancel')
      }
      const escape = (next: globalThis.KeyboardEvent) => {
        if (next.key === 'Escape') { next.preventDefault(); finish(true) }
      }
      window.addEventListener('pointermove', move, { passive: false })
      window.addEventListener('pointerup', end, true)
      window.addEventListener('pointercancel', end, true)
      window.addEventListener('keydown', escape)
      releaseGesture.current = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end, true)
        window.removeEventListener('pointercancel', end, true)
        window.removeEventListener('keydown', escape)
        if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
        releaseGesture.current = null
      }
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
      <div ref={root} className={cn('sortable-group', className)} aria-label={label}
        onDragStartCapture={event => event.preventDefault()}
        onPointerDownCapture={() => { suppressClick.current = false }}
        onClickCapture={event => {
          if (suppressClick.current && event.detail !== 0) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}>
        {children}
      </div>
      <span className="sr-only" role="status">{message}</span>
    </SortContext.Provider>
  )
}

export function SortableCard({ id, label, className, children }: { id: string; label: string; className?: string; children: ReactNode }) {
  const context = useContext(SortContext)
  if (!context) throw new Error('SortableCard requires SortableGroup')
  const { drag } = context
  const active = drag?.id === id && (drag.moved || drag.keyboard)
  const target = drag?.target === id && drag.id !== id
  return (
    <div data-sort-id={id} className={cn('sortable-slot', target && 'sortable-target', className)} onPointerDownCapture={event => context.start(id, event)}>
      <div className={cn('sortable-content', active && 'sortable-active')} style={active && !drag.keyboard ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : undefined}>
        {children}
      </div>
      <button type="button" className="sortable-handle" aria-label={`${label} 순서 이동`} aria-pressed={active}
        title="드래그해서 순서 변경 · 키보드: Enter → 방향키 → Enter · 취소: Escape"
        onBlur={() => { if (active && drag.keyboard) context.finish(true) }}
        onKeyDown={event => context.key(id, event)} onClick={event => event.stopPropagation()}>
        <Grip size={16} />
      </button>
      {target && <span className="sortable-drop-label">여기에 놓기</span>}
    </div>
  )
}
