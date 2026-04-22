/* Minimal seed for TV design screenshot comparison.
 * Creates: 6 equipment, 4 sensors, 3 UPS — with 24h of metric history and a few alarms.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

function nowMinus(minutes) { return new Date(Date.now() - minutes * 60 * 1000); }

async function main() {
  // Clean slate
  await p.alarm.deleteMany({});
  await p.alarmLog.deleteMany({});
  await p.metricHistory.deleteMany({});
  await p.metric.deleteMany({});
  await p.system.deleteMany({});

  // ---------- Equipment (6) ----------
  const equipNames = ['레이더', 'FMS', 'LCMS', 'VDL', 'MARC', '전송로'];
  const equipStatuses = ['normal', 'normal', 'warning', 'critical', 'normal', 'offline'];
  let portCounter = 1884;
  const equipSystems = [];
  for (let i = 0; i < equipNames.length; i++) {
    const s = await p.system.create({
      data: {
        name: equipNames[i],
        type: 'equipment',
        port: portCounter++,
        protocol: 'udp',
        status: equipStatuses[i],
        isEnabled: true,
        isActive: true,
      },
    });
    equipSystems.push(s);
  }

  // ---------- Sensors (4) ----------
  const sensorNames = ['관제실 A동', '관제실 B동', '통신실', '장비실'];
  const sensorConfig = {
    displayItems: [
      {
        name: '온도', itemType: 'temperature', unit: '°C', alarmEnabled: true,
        conditions: {
          normal: [{ operator: 'between', value1: 20, value2: 24 }],
          critical: [{ operator: 'gte', value1: 30 }],
          coldCritical: [{ operator: 'lte', value1: 10 }],
        },
      },
      {
        name: '습도', itemType: 'humidity', unit: '%', alarmEnabled: true,
        conditions: {
          normal: [{ operator: 'between', value1: 40, value2: 60 }],
          dryCritical: [{ operator: 'lte', value1: 20 }],
          humidCritical: [{ operator: 'gte', value1: 80 }],
        },
      },
    ],
  };
  const sensorSystems = [];
  for (let i = 0; i < sensorNames.length; i++) {
    const s = await p.system.create({
      data: {
        name: sensorNames[i],
        type: 'sensor',
        port: portCounter++,
        protocol: 'udp',
        status: i === 2 ? 'warning' : 'normal',
        isEnabled: true,
        isActive: true,
        config: JSON.stringify(sensorConfig),
      },
    });
    const temp = await p.metric.create({
      data: { systemId: s.id, name: '온도', value: 22 + i * 0.8, unit: '°C', min: 0, max: 40 },
    });
    const humid = await p.metric.create({
      data: { systemId: s.id, name: '습도', value: 45 + i * 3, unit: '%', min: 0, max: 100 },
    });
    // 24h history, 10-min intervals (144 points each)
    const tempPts = [], humidPts = [];
    for (let m = 24 * 60; m >= 0; m -= 10) {
      const t = nowMinus(m);
      const tempBase = 22 + i * 0.8;
      const humidBase = 45 + i * 3;
      tempPts.push({ metricId: temp.id, value: tempBase + Math.sin(m / 60) * 1.5 + (Math.random() - 0.5) * 0.4, recordedAt: t });
      humidPts.push({ metricId: humid.id, value: humidBase + Math.cos(m / 90) * 8 + (Math.random() - 0.5) * 2, recordedAt: t });
    }
    await p.metricHistory.createMany({ data: tempPts });
    await p.metricHistory.createMany({ data: humidPts });
    sensorSystems.push(s);
  }

  // ---------- UPS (3) ----------
  const upsNames = ['관제송신소 UPS', '관제탑 UPS', '경항공기 통신실'];
  const upsConfig = {
    displayItems: [
      { name: '입력전압', itemType: 'inputVoltage', unit: 'V', alarmEnabled: true, chartEnabled: true,
        conditions: { critical: [{ operator: 'lte', value1: 200 }, { operator: 'gte', value1: 240 }] } },
      { name: '입력전류', itemType: 'inputCurrent', unit: 'A', alarmEnabled: true, chartEnabled: true,
        conditions: { critical: [{ operator: 'gte', value1: 80 }] } },
      { name: '출력전압', itemType: 'outputVoltage', unit: 'V', alarmEnabled: true, chartEnabled: true,
        conditions: { critical: [{ operator: 'lte', value1: 200 }, { operator: 'gte', value1: 240 }] } },
      { name: '출력전류', itemType: 'outputCurrent', unit: 'A', alarmEnabled: true, chartEnabled: true,
        conditions: { critical: [{ operator: 'gte', value1: 80 }] } },
      { name: '주파수',   itemType: 'inputFrequency', unit: 'Hz', alarmEnabled: true, chartEnabled: true,
        conditions: { critical: [{ operator: 'lte', value1: 59.5 }, { operator: 'gte', value1: 60.5 }] } },
      { name: '배터리잔량', itemType: 'batteryRemaining', unit: '%', alarmEnabled: true, chartEnabled: true,
        conditions: { critical: [{ operator: 'lte', value1: 20 }] } },
      { name: '부하율', itemType: 'load', unit: '%', alarmEnabled: true, chartEnabled: false,
        conditions: { critical: [{ operator: 'gte', value1: 90 }] } },
    ],
  };
  for (let i = 0; i < upsNames.length; i++) {
    const s = await p.system.create({
      data: {
        name: upsNames[i],
        type: 'ups',
        port: portCounter++,
        protocol: 'udp',
        status: 'normal',
        isEnabled: true,
        isActive: true,
        config: JSON.stringify(upsConfig),
      },
    });
    const vals = {
      '입력전압': 220 + (Math.random() - 0.5) * 6,
      '입력전류': 25 + Math.random() * 15,
      '출력전압': 220 + (Math.random() - 0.5) * 4,
      '출력전류': 30 + Math.random() * 10,
      '주파수':   60.0 + (Math.random() - 0.5) * 0.2,
      '배터리잔량': 80 + Math.random() * 15,
      '부하율':   35 + Math.random() * 20,
    };
    for (const item of upsConfig.displayItems) {
      const m = await p.metric.create({
        data: {
          systemId: s.id,
          name: item.name,
          value: vals[item.name],
          unit: item.unit,
        },
      });
      // history
      const pts = [];
      for (let min = 24 * 60; min >= 0; min -= 10) {
        const base = vals[item.name];
        const amp = item.name === '주파수' ? 0.15 : base * 0.05;
        pts.push({ metricId: m.id, value: base + Math.sin(min / 40 + i) * amp + (Math.random() - 0.5) * amp * 0.5, recordedAt: nowMinus(min) });
      }
      await p.metricHistory.createMany({ data: pts });
    }
  }

  // ---------- Alarms ----------
  await p.alarm.create({
    data: { systemId: equipSystems[3].id, severity: 'critical', message: 'VDL 임계치 초과 상태', acknowledged: false, createdAt: nowMinus(8) },
  });
  await p.alarm.create({
    data: { systemId: equipSystems[2].id, severity: 'warning', message: 'LCMS 통신 불안정', acknowledged: false, createdAt: nowMinus(22) },
  });
  await p.alarm.create({
    data: { systemId: sensorSystems[2].id, severity: 'critical', message: '통신실 고온 알람', acknowledged: false, createdAt: nowMinus(45) },
  });
  await p.alarm.create({
    data: { systemId: sensorSystems[0].id, severity: 'warning', message: '관제실 A동 다습', acknowledged: true, acknowledgedAt: nowMinus(120), createdAt: nowMinus(180) },
  });
  await p.alarm.create({
    data: { systemId: equipSystems[5].id, severity: 'critical', message: '전송로 오프라인', acknowledged: true, acknowledgedAt: nowMinus(300), createdAt: nowMinus(360) },
  });

  console.log('Seeded: 6 equipment, 4 sensors, 3 UPS; 5 alarms; ~24h history');
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
