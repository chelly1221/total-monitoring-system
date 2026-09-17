// Catalog of client programs offered from the header 다운로드 menu.
// Add an entry here (and drop the file into the downloads directory) to publish a new one.

import { stat, readFile } from 'fs/promises'
import path from 'path'

export interface DownloadItem {
  id: string          // URL slug: /api/downloads/<id>
  name: string        // 사용자에게 보이는 이름
  description: string
  file: string        // file name inside the downloads directory
}

export const DOWNLOAD_ITEMS: DownloadItem[] = [
  {
    id: 'sound-client',
    name: '통합알람감시 음성탐지기',
    // Zip of the exe plus its own WebView2 runtime folder: facility PCs are offline and may
    // lack the runtime, so nothing needs installing. Built by sound-client/scripts/package.mjs.
    description: '시설 PC용 소리 감지·음소거 자동 해제 클라이언트 (Windows x64, 압축을 풀고 실행, 설치 불필요)',
    file: 'tms-soundsense.zip',
  },
  {
    id: 'ping-client',
    name: '네트워크 ping 감시',
    // Same portable layout as the sound client: exe + its own WebView2 runtime folder.
    // Npcap is not included; packet capture needs it installed separately, ping/alarm/auto-connect do not.
    description: '시설 PC용 네트워크 ping 감시 클라이언트 (Windows x64, 압축을 풀고 실행, 설치 불필요)',
    file: 'tms-ping-monitor.zip',
  },
]

export interface DownloadInfo extends DownloadItem {
  available: boolean
  size: number | null
  modifiedAt: string | null
  version: string | null
}

export function findDownload(id: string): DownloadItem | undefined {
  return DOWNLOAD_ITEMS.find(item => item.id === id)
}

/**
 * Directories searched in order for download files. Packaged app: DOWNLOADS_DIR
 * (set by Tauri to resources/downloads). Development: a local downloads/ drop
 * folder, then the sound client's own release build output.
 */
export function downloadDirectories(): string[] {
  const cwd = process.cwd()
  const dirs = [
    process.env.DOWNLOADS_DIR,
    path.join(cwd, 'downloads'),
    path.join(cwd, 'sound-client', 'src-tauri', 'target', 'release'),
    path.join(cwd, 'ping-client', 'src-tauri', 'target', 'release'),
  ]
  return dirs.filter((d): d is string => Boolean(d))
}

/** Locate the file for an item; null when it is not present in any directory. */
export async function locateDownload(item: DownloadItem): Promise<{ filePath: string; size: number; modifiedAt: Date } | null> {
  for (const dir of downloadDirectories()) {
    const filePath = path.join(dir, item.file)
    try {
      const info = await stat(filePath)
      if (info.isFile()) return { filePath, size: info.size, modifiedAt: info.mtime }
    } catch {
      // try the next directory
    }
  }
  return null
}

/**
 * Version string for an item: build-time manifest.json next to the files, or, in
 * development, the sound client's tauri.conf.json.
 */
async function readVersion(item: DownloadItem): Promise<string | null> {
  for (const dir of downloadDirectories()) {
    try {
      const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as Record<string, { version?: string }>
      const version = manifest[item.id]?.version
      if (version) return version
    } catch {
      // no manifest here
    }
  }
  if (item.id === 'sound-client' || item.id === 'ping-client') {
    try {
      const conf = JSON.parse(await readFile(path.join(process.cwd(), item.id, 'src-tauri', 'tauri.conf.json'), 'utf8')) as { version?: string }
      return conf.version ?? null
    } catch {
      return null
    }
  }
  return null
}

export async function listDownloads(): Promise<DownloadInfo[]> {
  return Promise.all(DOWNLOAD_ITEMS.map(async item => {
    const [located, version] = await Promise.all([locateDownload(item), readVersion(item)])
    return {
      ...item,
      available: located !== null,
      size: located?.size ?? null,
      modifiedAt: located?.modifiedAt.toISOString() ?? null,
      version,
    }
  }))
}
