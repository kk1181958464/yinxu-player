<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { PhCopy, PhMinus, PhSquare, PhX } from '@phosphor-icons/vue'

const maximized = ref(false)

async function syncMaximized(): Promise<void> {
  try {
    maximized.value = (await window.kugou?.windowIsMaximized?.()) ?? false
  } catch {
    maximized.value = false
  }
}

function minimize(): void {
  void window.kugou?.windowMinimize?.()
}

async function toggleMaximize(): Promise<void> {
  const next = await window.kugou?.windowMaximize?.()
  if (typeof next === 'boolean') maximized.value = next
  else await syncMaximized()
}

function closeWin(): void {
  void window.kugou?.windowClose?.()
}

onMounted(() => {
  void syncMaximized()
  window.addEventListener('resize', syncMaximized)
})

onUnmounted(() => {
  window.removeEventListener('resize', syncMaximized)
})
</script>

<template>
  <div class="window-controls" role="group" aria-label="窗口控制">
    <button class="win-btn" type="button" title="最小化" aria-label="最小化窗口" @click="minimize">
      <PhMinus :size="12" weight="bold" />
    </button>
    <button
      class="win-btn"
      type="button"
      :title="maximized ? '还原' : '最大化'"
      :aria-label="maximized ? '还原窗口' : '最大化窗口'"
      @click="toggleMaximize"
    >
      <PhCopy v-if="maximized" :size="11" weight="bold" />
      <PhSquare v-else :size="11" weight="bold" />
    </button>
    <button class="win-btn win-close" type="button" title="关闭" aria-label="关闭窗口" @click="closeWin">
      <PhX :size="12" weight="bold" />
    </button>
  </div>
</template>
