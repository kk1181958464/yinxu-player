<script setup lang="ts">
import { computed } from 'vue'
import { PhPlay } from '@phosphor-icons/vue'
import CoverArt from './CoverArt.vue'

withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    cover?: string
  }>(),
  { subtitle: '', cover: '' }
)

defineEmits<{ activate: [] }>()
</script>

<template>
  <button class="media-card" type="button" @click="$emit('activate')">
    <span class="media-art">
      <CoverArt :src="cover" :alt="title" :icon-size="22" />
      <span class="media-play" aria-hidden="true"><PhPlay :size="12" weight="fill" /></span>
    </span>
    <span class="media-title">{{ title }}</span>
    <span v-if="subtitle" class="media-sub">{{ subtitle }}</span>
  </button>
</template>
