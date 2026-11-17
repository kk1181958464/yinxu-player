<script setup lang="ts">
import { computed } from 'vue'
import { PhClock, PhPlay, PhPlus, PhTrash } from '@phosphor-icons/vue'
import CoverArt from './CoverArt.vue'
import { usePlayerStore } from '../stores/player'
import {
  type SongItem,
  songTitle,
  songArtist,
  songCover,
  songAlbum,
  songDurationSeconds,
  songMvHash
} from '../api/kugou'
import { formatClock } from '../utils/format'
import { useMvStore } from '../stores/mv'

const props = withDefaults(
  defineProps<{
    songs: SongItem[]
    emptyText?: string
    showAdd?: boolean
    showDelete?: boolean
  }>(),
  { emptyText: '这里还没有歌曲', showAdd: false, showDelete: false }
)

const emit = defineEmits<{
  (e: 'add-song', song: SongItem): void
  (e: 'delete-song', song: SongItem): void
}>()

const player = usePlayerStore()
const mv = useMvStore()

const currentHash = computed(() => player.current?.hash || '')
const hasActions = computed(() => props.showAdd || props.showDelete)

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

  <div v-else class="track-table" :class="{ 'with-actions': hasActions }">
    <div class="track-head" aria-hidden="true">
      <span class="track-col-index">#</span>
      <span class="track-col-main">标题</span>
      <span class="track-col-album">专辑</span>
      <span class="track-col-time"><PhClock :size="13" /></span>
      <span v-if="hasActions" class="track-col-action" />
    </div>

    <div class="track-list">
      <div
        v-for="(s, i) in songs"
        :key="(s.hash || '') + '-' + i"
        class="track-row"
        :class="{ current: s.hash === currentHash, unavailable: player.isUnavailable(s) }"
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
            <span class="track-name">
              {{ songTitle(s) }}
              <span v-if="player.isUnavailable(s)" class="track-badge">已下架</span>
              <button
                v-if="songMvHash(s)"
                class="track-mv"
                type="button"
                title="播放 MV"
                :aria-label="`播放 ${songTitle(s)} 的 MV`"
                @click.stop="mv.open(s)"
                @keydown.stop
              >
                MV
              </button>
            </span>
            <span class="track-artist">{{ songArtist(s) }}</span>
          </span>
        </span>

        <span class="track-col-album" :title="songAlbum(s)">{{ songAlbum(s) }}</span>
        <span class="track-col-time">{{ durationText(s) }}</span>
        <span v-if="hasActions" class="track-col-action">
          <button
            v-if="showAdd"
            class="track-action"
            type="button"
            title="添加到歌单"
            :aria-label="`把 ${songTitle(s)} 添加到歌单`"
            @click.stop="emit('add-song', s)"
            @keydown.stop
          >
            <PhPlus :size="15" />
          </button>
          <button
            v-if="showDelete"
            class="track-action danger"
            type="button"
            title="从歌单删除"
            :aria-label="`从歌单删除 ${songTitle(s)}`"
            @click.stop="emit('delete-song', s)"
            @keydown.stop
          >
            <PhTrash :size="15" />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>
