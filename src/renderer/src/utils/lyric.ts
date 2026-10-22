export interface LyricLine {
  time: number
  text: string
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
}

function fractionToMs(value?: string): number {
  if (!value) return 0
  if (value.length === 1) return Number(value) * 100
  if (value.length === 2) return Number(value) * 10
  return Number(value.slice(0, 3))
}

/** 解析 LRC；没有时间标签的行（标题、作者、版权等）直接跳过 */
export function parseLyric(raw: string): LyricLine[] {
  if (!raw || typeof raw !== 'string') return []

  let offset = 0
  const lines: LyricLine[] = []

  for (const sourceLine of raw.split(/\r?\n/)) {
    const offsetMatch = sourceLine.match(/^\[offset:([+-]?\d+)\]/i)
    if (offsetMatch) {
      offset = Number(offsetMatch[1]) / 1000
      continue
    }

    TIME_TAG.lastIndex = 0
    const moments: number[] = []
    let match: RegExpExecArray | null
    while ((match = TIME_TAG.exec(sourceLine))) {
      const minutes = Number(match[1])
      const seconds = Number(match[2])
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue
      moments.push(minutes * 60 + seconds + fractionToMs(match[3]) / 1000)
    }
    if (!moments.length) continue

    TIME_TAG.lastIndex = 0
    const text = decodeEntities(sourceLine.replace(TIME_TAG, '').trim())
    if (!text) continue

    for (const time of moments) {
      lines.push({ time: Math.max(0, time + offset), text })
    }
  }

  lines.sort((a, b) => a.time - b.time)
  return lines
}
