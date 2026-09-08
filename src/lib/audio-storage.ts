import path from 'path'

export function audioDirectories(): { writable: string; bundled: string } {
  const bundled = path.join(process.cwd(), 'public', 'audio')
  return { writable: process.env.AUDIO_DIR || bundled, bundled }
}
