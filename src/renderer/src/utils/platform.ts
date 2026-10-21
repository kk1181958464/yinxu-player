/** 运行环境探测：Electron 桌面 / Capacitor 原生 / 普通浏览器 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.kugou?.getApiBase === 'function'
}

export function isCapacitorNative(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    return Boolean(cap?.isNativePlatform?.())
  } catch {
    return false
  }
}

/** 有桌面窗控（最小化/最大化/关闭）的环境 */
export function isDesktopShell(): boolean {
  return isElectron()
}

export function applyPlatformClass(): void {
  const root = document.documentElement
  root.classList.remove('platform-electron', 'platform-native', 'platform-web')
  if (isElectron()) root.classList.add('platform-electron')
  else if (isCapacitorNative()) root.classList.add('platform-native')
  else root.classList.add('platform-web')
}

/**
 * 手机布局开关：
 * - Capacitor 原生端始终使用手机布局（即使平板宽度）
 * - 普通浏览器在窄屏时使用手机布局
 * - Electron 桌面端不使用（保留窗口控件与桌面分栏）
 */
export function isMobileLayout(): boolean {
  if (isCapacitorNative()) return true
  if (isElectron()) return false
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
}

export function applyLayoutClass(): void {
  document.documentElement.classList.toggle('mobile-layout', isMobileLayout())
}
