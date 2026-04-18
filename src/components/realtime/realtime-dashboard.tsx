'use client'

import { useRealtime } from './realtime-provider'
import { HealthCheckCard } from '@/components/cards/health-check-card'
import { AlertTriangle, Activity, Check, Plus, Zap, Siren, Radio } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { SensorAlarmEffects, getSensorAlarms } from './sensor-alarm-effects'
import { useCompactScreen } from '@/hooks/useCompactScreen'

export function RealtimeDashboard() {
  const router = useRouter()
  const { systems, alarms } = useRealtime()
  const [currentTime, setCurrentTime] = useState<Date>(new Date())
  const compact = useCompactScreen()
  // Filter to only show 장비상태 (equipment) type systems
  const equipmentSystems = systems.filter(
    (s) => s.type === '장비상태' || s.type === 'equipment'
  )

  // Update clock every 10 seconds (sufficient for monitoring dashboard)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 10000)
    return () => clearInterval(timer)
  }, [])

  // Find systems with problems (critical or warning status, only enabled systems)
  const problemSystems = equipmentSystems.filter(
    (s) => s.isEnabled !== false && (s.status === 'critical' || s.status === 'warning' || s.status === 'offline')
  )

  // Find unacknowledged alarms
  const unackedAlarms = alarms.filter((a) => !a.acknowledged && !a.resolvedAt)

  // Separate sensor alarms (온습도 with specific keywords) from equipment alarms
  const sensorAlarms = getSensorAlarms(unackedAlarms)
  const equipmentUnackedAlarms = unackedAlarms.filter(
    (a) => !sensorAlarms.some((sa) => sa.id === a.id)
  )

  // Equipment problems: equipment systems with bad status OR non-sensor unacked alarms
  const hasEquipmentProblems = problemSystems.length > 0 || equipmentUnackedAlarms.length > 0
  // Sensor alarms only show when no equipment problems
  const hasSensorAlarms = sensorAlarms.length > 0
  // 3-way: equipment > sensor > normal
  const hasProblems = hasEquipmentProblems

  // Distinguish offline-only from critical/warning problems
  const activeProblemSystems = problemSystems.filter(s => s.status === 'critical' || s.status === 'warning')
  const offlineProblemSystems = problemSystems.filter(s => s.status === 'offline')
  const criticalWarningUnackedAlarms = equipmentUnackedAlarms.filter(a => a.severity === 'critical' || a.severity === 'warning')
  const hasCriticalProblems = activeProblemSystems.length > 0 || criticalWarningUnackedAlarms.length > 0
  const isOfflineOnly = !hasCriticalProblems && hasProblems

  // Compact sizing
  const radarSize = compact ? 260 : 400
  const orbitCount = compact ? 7 : 10
  const orbitMaxRadius = compact ? 125 : 195
  const orbitMinRadius = compact ? 35 : 50
  const scannerSize = compact ? 160 : 350
  const ringSize = compact ? 80 : 180
  const ringCount = compact ? 3 : 7
  const innerTriCount = compact ? 6 : 12
  const innerTriRadius = compact ? 70 : 150
  const zapCount = compact ? 4 : 8

  return (
    <>
    <div className="flex h-full gap-4">
      {/* LEFT: System status cards */}
      <div className="hidden lg:flex w-48 flex-shrink-0 flex-col gap-1 overflow-y-auto">
        {equipmentSystems.map((system) => (
          <HealthCheckCard
            key={system.id}
            id={system.id}
            name={system.name}
            status={system.status}
            isEnabled={system.isEnabled !== false}
          />
        ))}
        {/* Add system button */}
        <Card
          onClick={() => router.push('/systems/new?type=equipment')}
          className="border-l-4 border-r-0 border-t-0 border-b-0 py-0 gap-0 rounded-md shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:brightness-110 cursor-pointer border-l-[#525252] !bg-[#404040]/50"
        >
          <CardContent className="flex items-center justify-center py-1 px-2">
            <Plus className="h-3.5 w-3.5 text-neutral-400" />
          </CardContent>
        </Card>
      </div>

      {/* RIGHT: Alert area or normal image */}
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-card">
        {hasProblems ? (
          <div className="flex h-full w-full flex-col">
            {/* Alert header - red for critical/warning, yellow for offline-only */}
            <div className={`animate-slow-pulse flex items-center justify-center gap-3 rounded-t-lg ${isOfflineOnly ? 'bg-yellow-600' : 'bg-red-600'} ${compact ? 'py-1.5' : 'py-4'}`}>
              <AlertTriangle className={`${compact ? 'h-6 w-6' : 'h-8 w-8'} text-white`} />
              <span className={`${compact ? 'text-xl' : 'text-3xl'} font-bold text-white`}>{isOfflineOnly ? '오프라인' : '장애발생'}</span>
              <AlertTriangle className={`${compact ? 'h-6 w-6' : 'h-8 w-8'} text-white`} />
            </div>

            {/* Problem list */}
            <div className={`flex flex-1 flex-col ${compact ? 'gap-2 p-3' : 'gap-3 p-6'} overflow-y-auto`}>
              {/* Critical systems first */}
              {problemSystems
                .filter((s) => s.status === 'critical')
                .map((system) => (
                  <div
                    key={system.id}
                    className={`rounded-lg border-2 border-red-500 bg-red-600/80 ${compact ? 'p-3' : 'p-4'}`}
                  >
                    <div className="flex justify-center">
                      <span className={`${compact ? 'text-6xl' : 'text-7xl'} font-bold text-white`}>
                        {system.name}
                      </span>
                    </div>
                  </div>
                ))}

              {/* Warning systems */}
              {problemSystems
                .filter((s) => s.status === 'warning')
                .map((system) => (
                  <div
                    key={system.id}
                    className={`rounded-lg border-2 border-yellow-300 bg-yellow-300 ${compact ? 'p-3' : 'p-4'}`}
                  >
                    <div className="flex justify-center">
                      <span className={`${compact ? 'text-6xl' : 'text-7xl'} font-bold text-black`}>
                        {system.name}
                      </span>
                    </div>
                  </div>
                ))}

              {/* Offline systems */}
              {offlineProblemSystems.map((system) => (
                <div
                  key={system.id}
                  className={`rounded-lg border-2 border-zinc-500 bg-zinc-700/80 ${compact ? 'p-3' : 'p-4'}`}
                >
                  <div className="flex justify-center">
                    <span className={`${compact ? 'text-6xl' : 'text-7xl'} font-bold text-zinc-300`}>
                      {system.name}
                    </span>
                  </div>
                </div>
              ))}

              {/* Unacked alarms not tied to a problem system (equipment only) */}
              {equipmentUnackedAlarms
                .filter(
                  (a) => !problemSystems.some((s) => s.id === a.systemId)
                )
                .slice(0, 5)
                .map((alarm) => (
                  <div
                    key={alarm.id}
                    className={`rounded-lg border-2 ${compact ? 'p-3' : 'p-4'} ${
                      alarm.severity === 'critical'
                        ? 'border-red-500 bg-red-600/80'
                        : alarm.severity === 'offline'
                          ? 'border-zinc-500 bg-zinc-700/80'
                          : 'border-yellow-300 bg-yellow-300'
                    }`}
                  >
                    <div className="flex justify-center">
                      <span
                        className={`${compact ? 'text-6xl' : 'text-7xl'} font-bold ${
                          alarm.severity === 'critical' || alarm.severity === 'offline'
                            ? 'text-white'
                            : 'text-black'
                        }`}
                      >
                        {alarm.system?.name ?? '시스템'}
                      </span>
                    </div>
                  </div>
                ))}

              {/* Dramatic alert animation when only 1 fault */}
              {problemSystems.length === 1 && unackedAlarms.filter(a => !problemSystems.some(s => s.id === a.systemId)).length === 0 && (
                <div className="relative flex-1 flex flex-col items-center justify-center overflow-hidden rounded-lg">
                  {/* Central alert icon with animations anchored to it */}
                  <div className="relative">
                    {/* Expanding rings */}
                    {Array.from({ length: ringCount }, (_, i) => (
                      <div
                        key={i}
                        className="absolute left-1/2 top-1/2 rounded-full"
                        style={{
                          width: `${ringSize}px`,
                          height: `${ringSize}px`,
                          borderWidth: '3px',
                          borderStyle: 'solid',
                          borderColor: problemSystems[0].status === 'critical'
                            ? 'rgba(239, 68, 68, 0.7)'
                            : 'rgba(234, 179, 8, 0.7)',
                          animation: 'alert-ring-expand 2.5s ease-out infinite',
                          animationDelay: `${i * 0.35}s`,
                        }}
                      />
                    ))}

                    {/* Rotating scanner beams - dual beams */}
                    <div
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                      style={{ width: `${scannerSize}px`, height: `${scannerSize}px`, animation: 'alert-scan 3s linear infinite' }}
                    >
                      <div
                        className="absolute top-1/2 left-1/2 w-1/2 h-1.5"
                        style={{
                          background: problemSystems[0].status === 'critical'
                            ? 'linear-gradient(to right, rgba(239, 68, 68, 1), rgba(239, 68, 68, 0.5), transparent)'
                            : 'linear-gradient(to right, rgba(234, 179, 8, 1), rgba(234, 179, 8, 0.5), transparent)',
                          boxShadow: problemSystems[0].status === 'critical'
                            ? '0 0 30px rgba(239, 68, 68, 0.8), 0 0 60px rgba(239, 68, 68, 0.4)'
                            : '0 0 30px rgba(234, 179, 8, 0.8), 0 0 60px rgba(234, 179, 8, 0.4)',
                        }}
                      />
                    </div>
                    <div
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                      style={{ width: `${scannerSize}px`, height: `${scannerSize}px`, animation: 'alert-scan 3s linear infinite reverse' }}
                    >
                      <div
                        className="absolute top-1/2 left-1/2 w-1/2 h-1"
                        style={{
                          background: problemSystems[0].status === 'critical'
                            ? 'linear-gradient(to right, rgba(239, 68, 68, 0.6), transparent)'
                            : 'linear-gradient(to right, rgba(234, 179, 8, 0.6), transparent)',
                          boxShadow: problemSystems[0].status === 'critical'
                            ? '0 0 20px rgba(239, 68, 68, 0.5)'
                            : '0 0 20px rgba(234, 179, 8, 0.5)',
                        }}
                      />
                    </div>

                    {/* Floating warning triangles - inner ring */}
                    {[...Array(innerTriCount)].map((_, i) => {
                      const angle = (i * (360 / innerTriCount)) * (Math.PI / 180)
                      const x = Math.cos(angle) * innerTriRadius
                      const y = Math.sin(angle) * innerTriRadius
                      const size = compact ? (12 + (i % 3) * 4) : (20 + (i % 3) * 8)
                      return (
                        <AlertTriangle
                          key={i}
                          className={`absolute animate-electric-pulse ${
                            problemSystems[0].status === 'critical' ? 'text-red-500/50' : 'text-yellow-500/50'
                          }`}
                          style={{
                            left: `calc(50% + ${x}px)`,
                            top: `calc(50% + ${y}px)`,
                            transform: 'translate(-50%, -50%)',
                            animation: 'alert-triangle-float 1.5s ease-in-out infinite',
                            animationDelay: `${i * 0.12}s`,
                            width: `${size}px`,
                            height: `${size}px`,
                          }}
                        />
                      )
                    })}

                    {/* Outer ring of smaller triangles (hidden in compact) */}
                    {!compact && [...Array(16)].map((_, i) => {
                      const angle = (i * 22.5 + 11.25) * (Math.PI / 180)
                      const radius = 200
                      const x = Math.cos(angle) * radius
                      const y = Math.sin(angle) * radius
                      return (
                        <AlertTriangle
                          key={`outer-${i}`}
                          className={`absolute ${
                            problemSystems[0].status === 'critical' ? 'text-red-500/30' : 'text-yellow-500/30'
                          }`}
                          style={{
                            left: `calc(50% + ${x}px)`,
                            top: `calc(50% + ${y}px)`,
                            transform: 'translate(-50%, -50%)',
                            animation: 'alert-triangle-float 2s ease-in-out infinite',
                            animationDelay: `${i * 0.1}s`,
                            width: '16px',
                            height: '16px',
                          }}
                        />
                      )
                    })}

                    {/* Siren icon circle - with intense glow animation */}
                    <div
                      className={`relative z-10 rounded-full ${compact ? 'p-4' : 'p-8'} ${
                        problemSystems[0].status === 'critical' ? 'animate-danger-glow' : 'animate-warning-glow'
                      }`}
                      style={{
                        background: problemSystems[0].status === 'critical'
                          ? 'linear-gradient(135deg, #ef4444, #dc2626, #b91c1c)'
                          : 'linear-gradient(135deg, #eab308, #ca8a04, #a16207)',
                      }}
                    >
                      {problemSystems[0].status === 'critical' ? (
                        <Siren className={`${compact ? 'h-12 w-12' : 'h-20 w-20'} text-white animate-shake`} />
                      ) : (
                        <AlertTriangle className={`${compact ? 'h-12 w-12' : 'h-20 w-20'} text-white animate-pulse`} />
                      )}
                    </div>
                  </div>

                  {/* Status text below - with flicker effect */}
                  <p
                    className={`${compact ? 'mt-3 text-2xl' : 'mt-8 text-3xl'} font-bold animate-text-flicker ${
                      problemSystems[0].status === 'critical' ? 'text-red-400' : 'text-yellow-400'
                    }`}
                    style={{
                      textShadow: problemSystems[0].status === 'critical'
                        ? '0 0 10px rgba(239, 68, 68, 1), 0 0 30px rgba(239, 68, 68, 0.8), 0 0 50px rgba(239, 68, 68, 0.5)'
                        : '0 0 10px rgba(234, 179, 8, 1), 0 0 30px rgba(234, 179, 8, 0.8), 0 0 50px rgba(234, 179, 8, 0.5)',
                    }}
                  >
                    {problemSystems[0].status === 'critical' ? '긴급 점검 필요' : '상태 확인 필요'}
                  </p>

                  {/* Lightning bolts - reduced count in compact */}
                  {compact ? (
                    <>
                      <Zap
                        className={`absolute top-2 left-2 h-5 w-5 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500' : 'text-yellow-500'
                        }`}
                      />
                      <Zap
                        className={`absolute top-2 right-2 h-5 w-5 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500' : 'text-yellow-500'
                        }`}
                        style={{ animationDelay: '0.3s' }}
                      />
                      <Zap
                        className={`absolute bottom-2 left-2 h-5 w-5 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500' : 'text-yellow-500'
                        }`}
                        style={{ animationDelay: '0.6s' }}
                      />
                      <Zap
                        className={`absolute bottom-2 right-2 h-5 w-5 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500' : 'text-yellow-500'
                        }`}
                        style={{ animationDelay: '0.9s' }}
                      />
                    </>
                  ) : (
                    <>
                      <Zap
                        className={`absolute top-4 left-4 h-10 w-10 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500' : 'text-yellow-500'
                        }`}
                      />
                      <Zap
                        className={`absolute top-4 left-16 h-7 w-7 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/70' : 'text-yellow-500/70'
                        }`}
                        style={{ animationDelay: '0.15s' }}
                      />
                      <Zap
                        className={`absolute top-4 right-4 h-10 w-10 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500' : 'text-yellow-500'
                        }`}
                        style={{ animationDelay: '0.3s' }}
                      />
                      <Zap
                        className={`absolute top-4 right-16 h-7 w-7 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/70' : 'text-yellow-500/70'
                        }`}
                        style={{ animationDelay: '0.45s' }}
                      />
                      <Zap
                        className={`absolute bottom-4 left-4 h-10 w-10 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500' : 'text-yellow-500'
                        }`}
                        style={{ animationDelay: '0.6s' }}
                      />
                      <Zap
                        className={`absolute bottom-4 left-16 h-7 w-7 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/70' : 'text-yellow-500/70'
                        }`}
                        style={{ animationDelay: '0.75s' }}
                      />
                      <Zap
                        className={`absolute bottom-4 right-4 h-10 w-10 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500' : 'text-yellow-500'
                        }`}
                        style={{ animationDelay: '0.9s' }}
                      />
                      <Zap
                        className={`absolute bottom-4 right-16 h-7 w-7 animate-warning-strobe ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/70' : 'text-yellow-500/70'
                        }`}
                        style={{ animationDelay: '1.05s' }}
                      />
                    </>
                  )}

                  {/* Radio waves (hidden in compact) */}
                  {!compact && (
                    <>
                      <Radio
                        className={`absolute left-6 top-1/2 -translate-y-1/2 h-8 w-8 animate-electric-pulse ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/70' : 'text-yellow-500/70'
                        }`}
                      />
                      <Radio
                        className={`absolute left-16 top-1/3 h-6 w-6 animate-electric-pulse ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/50' : 'text-yellow-500/50'
                        }`}
                        style={{ animationDelay: '0.2s' }}
                      />
                      <Radio
                        className={`absolute left-16 top-2/3 h-6 w-6 animate-electric-pulse ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/50' : 'text-yellow-500/50'
                        }`}
                        style={{ animationDelay: '0.4s' }}
                      />
                      <Radio
                        className={`absolute right-6 top-1/2 -translate-y-1/2 h-8 w-8 animate-electric-pulse ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/70' : 'text-yellow-500/70'
                        }`}
                        style={{ animationDelay: '0.5s' }}
                      />
                      <Radio
                        className={`absolute right-16 top-1/3 h-6 w-6 animate-electric-pulse ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/50' : 'text-yellow-500/50'
                        }`}
                        style={{ animationDelay: '0.7s' }}
                      />
                      <Radio
                        className={`absolute right-16 top-2/3 h-6 w-6 animate-electric-pulse ${
                          problemSystems[0].status === 'critical' ? 'text-red-500/50' : 'text-yellow-500/50'
                        }`}
                        style={{ animationDelay: '0.9s' }}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : hasSensorAlarms ? (
          /* Sensor alarm visual effects (온습도) */
          <SensorAlarmEffects alarms={sensorAlarms} />
        ) : (
          /* No problems - airport control tower theme */
          <div className="flex h-full w-full flex-col items-center justify-center">
            {/* Orbital system visualization */}
            <div className="relative" style={{ height: `${radarSize}px`, width: `${radarSize}px` }}>
              {/* Radar background glow - brighter */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  width: `${radarSize}px`,
                  height: `${radarSize}px`,
                  background: 'radial-gradient(circle, rgba(74,222,128,0.25) 0%, rgba(34,197,94,0.15) 40%, rgba(34,197,94,0.05) 60%, transparent 80%)',
                }}
              />

              {/* Orbiting dots */}
              {Array.from({ length: orbitCount }, (_, index) => {
                const radiusRange = orbitMaxRadius - orbitMinRadius
                const radius = orbitMinRadius + Math.round(index * (radiusRange / Math.max(orbitCount - 1, 1)))
                const duration = 20 + (index * 4)
                const startAngle = (index * 137.508) % 360
                const delay = (startAngle / 360) * duration
                const size = compact
                  ? (5 + (index % 3) * 2)   // 5, 7, 9 in compact
                  : (6 + (index % 5) * 3)   // 6, 9, 12, 15, 18

                return (
                  <div
                    key={index}
                    className="absolute left-1/2 top-1/2"
                    style={{
                      animation: `orbit ${duration}s linear infinite`,
                      animationDelay: `-${delay}s`,
                      ['--orbit-radius' as string]: `${radius}px`,
                    }}
                  >
                    <div
                      className="rounded-full bg-green-300"
                      style={{
                        width: `${size}px`,
                        height: `${size}px`,
                        marginLeft: `-${size / 2}px`,
                        marginTop: `-${size / 2}px`,
                        boxShadow: `0 0 ${size * 2}px rgba(134,239,172,0.9), 0 0 ${size * 4}px rgba(74,222,128,0.5)`,
                      }}
                    />
                  </div>
                )
              })}

              {/* Custom radar icon */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className={`relative ${compact ? 'h-16 w-16' : 'h-24 w-24'}`}>
                  {/* Radar circles */}
                  <div className="absolute inset-0 rounded-full border-[3px] border-green-400/50" style={{ boxShadow: '0 0 10px rgba(74,222,128,0.3), inset 0 0 10px rgba(74,222,128,0.1)' }} />
                  <div className={`absolute ${compact ? 'inset-2' : 'inset-3'} rounded-full border-[3px] border-green-400/60`} style={{ boxShadow: '0 0 8px rgba(74,222,128,0.4), inset 0 0 8px rgba(74,222,128,0.15)' }} />
                  <div className={`absolute ${compact ? 'inset-4' : 'inset-6'} rounded-full border-[3px] border-green-400/70`} style={{ boxShadow: '0 0 6px rgba(74,222,128,0.5), inset 0 0 6px rgba(74,222,128,0.2)' }} />
                  {/* Radar cross lines */}
                  <div className="absolute left-1/2 top-0 bottom-0 w-[3px] -translate-x-1/2 bg-green-400/40" style={{ boxShadow: '0 0 6px rgba(74,222,128,0.5)' }} />
                  <div className="absolute top-1/2 left-0 right-0 h-[3px] -translate-y-1/2 bg-green-400/40" style={{ boxShadow: '0 0 6px rgba(74,222,128,0.5)' }} />
                  {/* Center dot with check */}
                  <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${compact ? 'h-7 w-7' : 'h-10 w-10'} rounded-full bg-green-400 flex items-center justify-center`} style={{ boxShadow: '0 0 20px rgba(134,239,172,1), 0 0 40px rgba(74,222,128,0.8), 0 0 60px rgba(34,197,94,0.4)' }}>
                    <Check className={`${compact ? 'h-4 w-4' : 'h-6 w-6'} text-white`} strokeWidth={3} />
                  </div>
                </div>
              </div>
            </div>

            {/* Main text */}
            <h2
              className="mt-4 text-4xl font-bold text-green-400"
              style={{
                textShadow: '0 0 20px rgba(34,197,94,0.4)'
              }}
            >
              모든 시스템 정상
            </h2>
            {!compact && (
              <p className="mt-2 text-lg text-green-500/70">
                All Systems Operational
              </p>
            )}

            {/* System count */}
            {!compact && (
              <div className="mt-6 px-6 py-3 flex items-center gap-2 rounded-full bg-green-500/10">
                <Activity className="h-5 w-5 text-green-500" />
                <span className="text-lg font-medium text-green-400">
                  {equipmentSystems.filter(s => s.isEnabled !== false).length}개 시설 정상 운영 중
                </span>
              </div>
            )}

            {/* Current time */}
            {!compact && (
              <div className="mt-5 text-center">
                <p className="font-mono text-3xl font-light tabular-nums text-muted-foreground">
                  {currentTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </p>
                <p className="mt-1 text-sm text-muted-foreground/60">
                  {currentTime.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    </>
  )
}
