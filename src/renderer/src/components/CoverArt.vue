<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhMusicNote } from '@phosphor-icons/vue'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    iconSize?: number
  }>(),
  { src: '', alt: '', iconSize: 18 }
)

const failed = ref(false)
const loaded = ref(false)
const activeSrc = ref(props.src)
const triedPlainHttp = ref(false)

watch(
  () => props.src,
  (src) => {
    activeSrc.value = src
    failed.value = false
    loaded.value = false
    triedPlainHttp.value = false
  }
)

/**
 * 图片 CDN 默认升级到 HTTPS；部分网络/WebView 环境会拦截 HTTPS 图片，
 * 首次失败时退回 HTTP，避免整屏封面变成占位图。
 */
function onImageError(): void {
  if (!triedPlainHttp.value && activeSrc.value.startsWith('https://')) {
    triedPlainHttp.value = true
    activeSrc.value = activeSrc.value.replace(/^https:\/\//, 'http://')
    loaded.value = false
    return
  }
  failed.value = true
}

/** 没有封面时用标题生成稳定的色相，避免出现破图 */
const hue = computed(() => {
  const seed = props.alt || 'music'
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
})

const cssVars = computed(() => ({ '--cover-hue': String(hue.value) }))
</script>

<template>
  <span class="cover" :style="cssVars">
    <img
      v-if="activeSrc && !failed"
      :class="{ loaded }"
      :src="activeSrc"
      :alt="alt"
      loading="lazy"
      decoding="async"
      @load="loaded = true"
      @error="onImageError"
    />
    <span v-else class="cover-fallback" aria-hidden="true">
      <PhMusicNote :size="iconSize" weight="fill" />
    </span>
  </span>
</template>
