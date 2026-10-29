import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

/** 用户手动滚动歌词后，暂停自动跟随的时长 */
const USER_SCROLL_HOLD_MS = 3000

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 把当前歌词行滚到视口中间。用户滚轮/拖动后暂停跟随一会儿，点击歌词行会立即恢复；
 * 歌词从隐藏变为可见时直接定位，不做平滑滚动。
 */
export function useLyricAutoScroll(
  container: Ref<HTMLElement | null>,
  lineSelector: string,
  activeIndex: Ref<number>,
  visible: () => boolean = () => true
): void {
  let holdUntil = 0
  const hold = (): void => {
    holdUntil = Date.now() + USER_SCROLL_HOLD_MS
  }
  const release = (): void => {
    holdUntil = 0
  }

  async function center(smooth: boolean): Promise<void> {
    if (!visible() || activeIndex.value < 0) return
    await nextTick()
    const box = container.value
    const line = box?.querySelectorAll<HTMLElement>(lineSelector)[activeIndex.value]
    if (!box || !line) return
    const boxRect = box.getBoundingClientRect()
    const lineRect = line.getBoundingClientRect()
    // 用 rect 高度而不是 clientHeight：非当前行带 scale，视觉中心才准确
    const top =
      box.scrollTop + (lineRect.top - boxRect.top) - box.clientHeight / 2 + lineRect.height / 2
    box.scrollTo({
      top: Math.max(0, top),
      behavior: smooth && !reducedMotion() ? 'smooth' : 'auto'
    })
  }

  watch(container, (el, old) => {
    old?.removeEventListener('wheel', hold)
    old?.removeEventListener('touchmove', hold)
    old?.removeEventListener('click', release)
    el?.addEventListener('wheel', hold, { passive: true })
    el?.addEventListener('touchmove', hold, { passive: true })
    el?.addEventListener('click', release)
  })

  watch(activeIndex, () => {
    if (Date.now() < holdUntil) return
    void center(true)
  })

  watch(visible, (shown) => {
    if (!shown) return
    release()
    void center(false)
  })

  onBeforeUnmount(() => {
    const el = container.value
    el?.removeEventListener('wheel', hold)
    el?.removeEventListener('touchmove', hold)
    el?.removeEventListener('click', release)
  })
}
