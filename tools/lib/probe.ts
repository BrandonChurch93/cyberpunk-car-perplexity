import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

export interface Probe {
  codec: string
  width: number
  height: number
  fps: number
  frames: number
  pixelFormat: string
  bytes: number
  durationSeconds: number
}

export function probe(file: string): Probe {
  if (!existsSync(file)) throw new Error(`${file} does not exist`)
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,pix_fmt:format=duration', '-of', 'json', file], { encoding: 'utf8' })
  const json = JSON.parse(out) as { streams: Array<Record<string, string | number>>; format: { duration?: string } }
  const s = json.streams[0]
  if (!s) throw new Error(`${file} has no video stream`)
  const [n, d] = String(s.avg_frame_rate !== '0/0' ? s.avg_frame_rate : s.r_frame_rate).split('/').map(Number)
  return {
    codec: String(s.codec_name),
    width: Number(s.width),
    height: Number(s.height),
    fps: d ? n / d : n,
    frames: Number(s.nb_read_frames),
    pixelFormat: String(s.pix_fmt),
    bytes: statSync(file).size,
    durationSeconds: Number(json.format.duration ?? 0),
  }
}

export const megabytes = (bytes: number): number => bytes / (1024 * 1024)
