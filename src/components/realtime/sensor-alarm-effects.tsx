'use client'

import { useMemo } from 'react'
import type { PrismaAlarm } from '@/types'
import { useCompactScreen } from '@/hooks/useCompactScreen'

type SensorAlarmType = 'high-temp' | 'low-temp' | 'dry' | 'humid'

function detectSensorAlarmType(message: string): SensorAlarmType | null {
  if (message.includes('고온')) return 'high-temp'
  if (message.includes('저온')) return 'low-temp'
  if (message.includes('건조')) return 'dry'
  if (message.includes('다습')) return 'humid'
  return null
}

const PRIORITY: SensorAlarmType[] = ['high-temp', 'low-temp', 'dry', 'humid']

const LABEL_MAP: Record<SensorAlarmType, string> = {
  'high-temp': '고온',
  'low-temp': '저온',
  'dry': '건조',
  'humid': '다습',
}

interface SensorAlarmEffectsProps {
  alarms: PrismaAlarm[]
}

export function SensorAlarmEffects({ alarms }: SensorAlarmEffectsProps) {
  const compact = useCompactScreen()
  const { primaryType, activeTypes, primaryAlarm, typeToName } = useMemo(() => {
    const types = new Set<SensorAlarmType>()
    const nameMap = new Map<SensorAlarmType, string>()
    let firstAlarm: PrismaAlarm | null = null
    let firstType: SensorAlarmType | null = null

    for (const alarm of alarms) {
      const t = detectSensorAlarmType(alarm.message)
      if (t) {
        types.add(t)
        if (!nameMap.has(t)) {
          nameMap.set(t, alarm.system?.name ?? '온습도')
        }
        if (!firstAlarm) {
          firstAlarm = alarm
          firstType = t
        }
      }
    }

    // Pick highest-priority type
    const primary = PRIORITY.find(p => types.has(p)) ?? firstType
    return {
      primaryType: primary,
      activeTypes: Array.from(types),
      primaryAlarm: firstAlarm,
      typeToName: nameMap,
    }
  }, [alarms])

  if (!primaryType || !primaryAlarm) return null

  const multi = activeTypes.length > 1
  // 1개: 단일, 2~3개: 세로 분할, 4개: 2×2
  const gridClass = activeTypes.length === 1 ? 'grid-cols-1'
    : activeTypes.length <= 3 ? 'grid-cols-1'
    : 'grid-cols-2'

  // systemName is now per-type via typeToName

  return (
    <div className={`grid h-full w-full gap-2 ${gridClass}`}>
      {activeTypes.map(t => (
        <div key={t} className="relative flex h-full w-full overflow-hidden rounded-lg">
          {/* 타입별 Effect 배경 */}
          {t === 'high-temp' && <HighTempEffect compact={compact} />}
          {t === 'low-temp' && <LowTempEffect compact={compact} />}
          {t === 'dry' && <DryEffect compact={compact} />}
          {t === 'humid' && <HumidEffect compact={compact} />}

          {/* 오버레이 */}
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center">
            <div className={`rounded-2xl bg-black/50 backdrop-blur-sm border border-white/10 ${
              compact
                ? multi ? 'px-8 py-6' : 'px-12 py-10'
                : multi ? 'px-14 py-10' : 'px-16 py-16'
            }`}>
              <p className={`text-center font-medium text-white/80 ${
                compact
                  ? multi ? 'text-3xl' : 'text-4xl'
                  : multi ? 'text-4xl' : 'text-5xl'
              }`}>
                {typeToName.get(t) ?? '온습도'}
              </p>
              <p className={`mt-2 text-center font-bold text-white ${
                compact
                  ? multi ? 'text-5xl' : 'text-6xl'
                  : multi ? 'text-7xl' : 'text-8xl'
              }`}>
                {LABEL_MAP[t]} 경고
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Detect sensor alarms from alarm list (only from sensor-type systems) */
export function getSensorAlarms(alarms: PrismaAlarm[]): PrismaAlarm[] {
  return alarms.filter(a =>
    a.system?.type === 'sensor' && detectSensorAlarmType(a.message) !== null
  )
}

/* ===== Effect Sub-Components ===== */

function HighTempEffect({ compact }: { compact: boolean }) {
  const flameCount = compact ? 10 : 25
  const emberCount = compact ? 5 : 15
  const flames = useMemo(() =>
    Array.from({ length: flameCount }, (_, i) => ({
      left: `${(i / flameCount) * 100}%`,
      size: 8 + Math.random() * 16,
      duration: 2 + Math.random() * 3,
      delay: Math.random() * 4,
      opacity: 0.5 + Math.random() * 0.5,
    })), [flameCount]
  )
  const embers = useMemo(() =>
    Array.from({ length: emberCount }, (_, i) => ({
      left: `${10 + Math.random() * 80}%`,
      size: 3 + Math.random() * 5,
      duration: 3 + Math.random() * 4,
      delay: Math.random() * 5,
    })), [emberCount]
  )

  return (
    <div
      className="absolute inset-0 z-10"
      style={{
        background: 'linear-gradient(to top, rgba(220, 38, 38, 0.4) 0%, rgba(251, 146, 60, 0.2) 40%, rgba(30, 30, 30, 0.9) 100%)',
        animation: 'fire-glow 3s ease-in-out infinite',
      }}
    >
      {/* Flame particles */}
      {flames.map((f, i) => (
        <div
          key={i}
          className="absolute bottom-0 rounded-full"
          style={{
            left: f.left,
            width: `${f.size}px`,
            height: `${f.size * 1.5}px`,
            background: `radial-gradient(ellipse, rgba(251, 146, 60, ${f.opacity}), rgba(239, 68, 68, 0.3), transparent)`,
            animation: `flame-rise ${f.duration}s ease-out infinite`,
            animationDelay: `${f.delay}s`,
          }}
        />
      ))}
      {/* Ember sparks */}
      {embers.map((e, i) => (
        <div
          key={`ember-${i}`}
          className="absolute bottom-0 rounded-full"
          style={{
            left: e.left,
            width: `${e.size}px`,
            height: `${e.size}px`,
            background: 'radial-gradient(circle, #fbbf24, #f97316, transparent)',
            animation: `ember-float ${e.duration}s ease-out infinite`,
            animationDelay: `${e.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

function LowTempEffect({ compact }: { compact: boolean }) {
  const snowCount = compact ? 12 : 35
  const snowflakes = useMemo(() =>
    Array.from({ length: snowCount }, (_, i) => ({
      left: `${(i / snowCount) * 100}%`,
      size: 4 + Math.random() * 8,
      duration: 4 + Math.random() * 6,
      delay: Math.random() * 8,
      drift: -30 + Math.random() * 60,
      opacity: 0.4 + Math.random() * 0.6,
    })), [snowCount]
  )

  return (
    <div
      className="absolute inset-0 z-10"
      style={{
        background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0.15) 0%, rgba(219, 234, 254, 0.08) 50%, rgba(30, 30, 30, 0.95) 100%)',
        animation: 'frost-glow 4s ease-in-out infinite',
      }}
    >
      {/* Snowflakes */}
      {snowflakes.map((s, i) => (
        <div
          key={i}
          className="absolute top-0 rounded-full"
          style={{
            left: s.left,
            width: `${s.size}px`,
            height: `${s.size}px`,
            background: `radial-gradient(circle, rgba(255,255,255,${s.opacity}), rgba(191,219,254,0.3), transparent)`,
            ['--snow-drift' as string]: `${s.drift}px`,
            animation: `snowfall ${s.duration}s linear infinite`,
            animationDelay: `${s.delay}s`,
            boxShadow: `0 0 ${s.size}px rgba(191,219,254,0.5)`,
          }}
        />
      ))}
      {/* Frost edges */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            linear-gradient(135deg, rgba(191,219,254,0.15) 0%, transparent 30%),
            linear-gradient(225deg, rgba(191,219,254,0.15) 0%, transparent 30%),
            linear-gradient(315deg, rgba(191,219,254,0.1) 0%, transparent 25%),
            linear-gradient(45deg, rgba(191,219,254,0.1) 0%, transparent 25%)
          `,
          animation: 'frost-pulse 5s ease-in-out infinite',
        }}
      />
    </div>
  )
}

function DryEffect({ compact }: { compact: boolean }) {
  const dustCount = compact ? 8 : 20
  const heatLineCount = compact ? 4 : 8
  const dust = useMemo(() =>
    Array.from({ length: dustCount }, (_, i) => ({
      left: `${10 + Math.random() * 80}%`,
      top: `${10 + Math.random() * 80}%`,
      size: 3 + Math.random() * 6,
      duration: 6 + Math.random() * 8,
      delay: Math.random() * 6,
      dx: -40 + Math.random() * 80,
      dy: -30 + Math.random() * 60,
      dx2: -30 + Math.random() * 60,
      dy2: -20 + Math.random() * 40,
    })), [dustCount]
  )
  const heatLines = useMemo(() =>
    Array.from({ length: heatLineCount }, (_, i) => ({
      left: `${10 + (i / heatLineCount) * 80}%`,
      height: 40 + Math.random() * 60,
      duration: 3 + Math.random() * 3,
      delay: Math.random() * 4,
    })), [heatLineCount]
  )

  return (
    <div
      className="absolute inset-0 z-10"
      style={{
        background: 'linear-gradient(to bottom, rgba(180, 83, 9, 0.15) 0%, rgba(217, 119, 6, 0.1) 50%, rgba(30, 30, 30, 0.95) 100%)',
      }}
    >
      {/* SVG crack lines */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="20" y1="80" x2="35" y2="60" stroke="rgba(180,83,9,0.3)" strokeWidth="0.3"
          style={{ animation: 'crack-pulse 6s ease-in-out infinite', strokeDasharray: 100 }} />
        <line x1="35" y1="60" x2="30" y2="40" stroke="rgba(180,83,9,0.25)" strokeWidth="0.2"
          style={{ animation: 'crack-pulse 6s ease-in-out infinite 0.5s', strokeDasharray: 100 }} />
        <line x1="60" y1="90" x2="70" y2="65" stroke="rgba(180,83,9,0.3)" strokeWidth="0.3"
          style={{ animation: 'crack-pulse 6s ease-in-out infinite 1s', strokeDasharray: 100 }} />
        <line x1="70" y1="65" x2="65" y2="45" stroke="rgba(180,83,9,0.2)" strokeWidth="0.2"
          style={{ animation: 'crack-pulse 6s ease-in-out infinite 1.5s', strokeDasharray: 100 }} />
        <line x1="80" y1="85" x2="85" y2="55" stroke="rgba(180,83,9,0.25)" strokeWidth="0.25"
          style={{ animation: 'crack-pulse 6s ease-in-out infinite 2s', strokeDasharray: 100 }} />
      </svg>
      {/* Dust particles */}
      {dust.map((d, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: d.left,
            top: d.top,
            width: `${d.size}px`,
            height: `${d.size}px`,
            background: 'radial-gradient(circle, rgba(217,119,6,0.6), rgba(180,83,9,0.2), transparent)',
            ['--dust-x' as string]: `${d.dx}px`,
            ['--dust-y' as string]: `${d.dy}px`,
            ['--dust-x2' as string]: `${d.dx2}px`,
            ['--dust-y2' as string]: `${d.dy2}px`,
            animation: `dust-drift ${d.duration}s ease-in-out infinite`,
            animationDelay: `${d.delay}s`,
          }}
        />
      ))}
      {/* Heat shimmer lines */}
      {heatLines.map((h, i) => (
        <div
          key={`heat-${i}`}
          className="absolute bottom-0"
          style={{
            left: h.left,
            width: '2px',
            height: `${h.height}%`,
            background: 'linear-gradient(to top, rgba(217,119,6,0.15), transparent)',
            animation: `heat-shimmer ${h.duration}s ease-in-out infinite`,
            animationDelay: `${h.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

function HumidEffect({ compact }: { compact: boolean }) {
  const raindropCount = compact ? 15 : 50
  const rippleCount = compact ? 4 : 8
  const raindrops = useMemo(() =>
    Array.from({ length: raindropCount }, (_, i) => ({
      left: `${(i / raindropCount) * 100}%`,
      width: 1 + Math.random() * 1.5,
      height: 15 + Math.random() * 25,
      duration: 0.6 + Math.random() * 0.8,
      delay: Math.random() * 2,
      drift: -8 + Math.random() * 4,
      opacity: 0.3 + Math.random() * 0.4,
    })), [raindropCount]
  )
  const ripples = useMemo(() =>
    Array.from({ length: rippleCount }, (_, i) => ({
      left: `${10 + Math.random() * 80}%`,
      duration: 2 + Math.random() * 2,
      delay: Math.random() * 4,
      size: 10 + Math.random() * 20,
    })), [rippleCount]
  )

  return (
    <div
      className="absolute inset-0 z-10"
      style={{
        background: 'linear-gradient(to bottom, rgba(14, 116, 144, 0.15) 0%, rgba(34, 211, 238, 0.08) 60%, rgba(30, 30, 30, 0.95) 100%)',
      }}
    >
      {/* Raindrops */}
      {raindrops.map((r, i) => (
        <div
          key={i}
          className="absolute top-0"
          style={{
            left: r.left,
            width: `${r.width}px`,
            height: `${r.height}px`,
            background: `linear-gradient(to bottom, transparent, rgba(34, 211, 238, ${r.opacity}))`,
            borderRadius: '0 0 2px 2px',
            ['--rain-drift' as string]: `${r.drift}px`,
            animation: `rainfall ${r.duration}s linear infinite`,
            animationDelay: `${r.delay}s`,
          }}
        />
      ))}
      {/* Water ripples at bottom */}
      {ripples.map((rp, i) => (
        <div
          key={`ripple-${i}`}
          className="absolute rounded-full border border-cyan-400/30"
          style={{
            left: rp.left,
            bottom: '5%',
            width: `${rp.size}px`,
            height: `${rp.size * 0.4}px`,
            animation: `water-ripple ${rp.duration}s ease-out infinite`,
            animationDelay: `${rp.delay}s`,
          }}
        />
      ))}
      {/* Mist overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            linear-gradient(90deg, rgba(34,211,238,0.05) 0%, rgba(34,211,238,0.1) 50%, rgba(34,211,238,0.05) 100%)
          `,
          animation: 'mist-drift 8s ease-in-out infinite',
        }}
      />
    </div>
  )
}
