<script setup lang="ts">
import { computed } from 'vue'
import { PhClock, PhPlay } from '@phosphor-icons/vue'
import CoverArt from './CoverArt.vue'
import { usePlayerStore } from '../stores/player'
import {
  type SongItem,
  songTitle,
  songArtist,
  songCover,
  songAlbum,
  songDurationSeconds
} from '../api/kugou'
import { formatClock } from '../utils/format'

const props = withDefaults(
  defineProps<{
    songs: SongItem[]
    emptyText?: string
  }>(),
  { emptyText: '这里还没有歌曲' }
)

const player = usePlayerStore()

const currentHash = computed(() => player.current?.hash || '')

function isPlaying(s: SongItem): boolean {
  return s.hash === currentHash.value && player.playing
}

function durationText(s: SongItem): string {
  const seconds = songDurationSeconds(s)
  return seconds > 0 ? formatClock(seconds) : '--:--'
}

function activate(s: SongItem): void {
  if (s.hash === currentHash.value) {
    player.toggle()
    return
  }
  void player.playSong(s, props.songs)
}
</script>

<template>
  <div v-if="!songs.length" class="state-panel state-panel-compact">
    <p>{{ emptyText }}</p>
  </div>

  <div v-else class="track-table">
    <div class="track-head" aria-hidden="true">
      <span class="track-col-index">#</span>
      <span class="track-col-main">标题</span>
      <span class="track-col-album">专辑</span>
      <span class="track-col-time"><PhClock :size="13" /></span>
    </div>

    <div class="track-list">
      <div
        v-for="(s, i) in songs"
        :key="(s.hash || '') + '-' + i"
        class="track-row"
        :class="{ current: s.hash === currentHash }"
        role="button"
        tabindex="0"
        :aria-label="`播放 ${songTitle(s)} - ${songArtist(s)}`"
        @click="activate(s)"
        @keydown.enter.prevent="activate(s)"
        @keydown.space.prevent="activate(s)"
      >
        <span class="track-col-index">
          <span v-if="isPlaying(s)" class="eq" aria-hidden="true"><i /><i /><i /></span>
          <span v-else class="track-index">{{ i + 1 }}</span>
          <PhPlay v-if="!isPlaying(s)" class="track-play" :size="12" weight="fill" aria-hidden="true" />
        </span>

        <span class="track-col-main">
          <CoverArt class="track-art" :src="songCover(s)" :alt="songTitle(s)" :icon-size="14" />
          <span class="track-text">
            <span class="track-name">{{ songTitle(s) }}</span>
            <span class="track-artist">{{ songArtist(s) }}</span>
          </span>
        </span>

        <span class="track-col-album" :title="songAlbum(s)">{{ songAlbum(s) }}</span>
        <span class="track-col-time">{{ durationText(s) }}</span>
      </div>
    </div>
  </div>
</template>
