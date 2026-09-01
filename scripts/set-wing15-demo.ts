// 임시: 앱 DB에 wing15 데모 모드 플래그 설정
import { PrismaClient } from '@prisma/client'

const value = process.argv[2] === 'off' ? 'false' : 'true'
const dbPath = `${process.env.APPDATA}\\kr.chelly.tms-portable\\app.db`
const prisma = new PrismaClient({ datasourceUrl: `file:${dbPath}` })

async function main() {
  await prisma.setting.upsert({
    where: { key: 'wing15Demo' },
    update: { value },
    create: { key: 'wing15Demo', value, category: 'wing15' },
  })
  if (value === 'false') {
    await prisma.setting.deleteMany({ where: { key: 'wing15DemoConfirmed' } })
  }
  console.log(`wing15Demo=${value} (${dbPath})`)
}

main().finally(() => prisma.$disconnect())
