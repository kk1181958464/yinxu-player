/** 时间与文案格式化工具 */

/** 秒 → m:ss（用于播放进度） */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 秒 → 中文时长（用于歌单总时长等） */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分钟`
  return `${Math.max(m, 1)} 分钟`
}

/** 根据当前时段返回问候语 */
export function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 取名字首字（无头像时的占位） */
export function initialOf(name: string): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return '♪'
  const first = Array.from(trimmed)[0] || '♪'
  return first.toUpperCase()
}
