<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { PhArrowClockwise, PhPlay, PhWarningCircle } from '@phosphor-icons/vue'
import {
  fetchPlaylistTracks,
  removePlaylistTracks,
  fillMissingCovers,
  songTitle,
  type SongItem,
  songCover,
  songDurationSeconds,
  coverAt
} from '../api/kugou'
import { usePlayerStore } from '../stores/player'
import { formatDuration } from '../utils/format'
import CoverArt from '../components/CoverArt.vue'
import SongList from '../components/SongList.vue'

const route = useRoute()
const player = usePlayerStore()

const songs = ref<SongItem[]>([])
const loading = ref(true)
const error = ref('')
const deleteError = ref('')
const deleting = ref(false)

const title = computed(() => String(route.query.name || '歌单'))
const listid = computed(() => String(route.query.listid || ''))
const gid = computed(() => {
  const q = String(route.query.gid || '')
  if (q) return q
  if (!listid.value) return String(route.params.id || '')
  return ''
})
const listType = computed(() => Number(route.query.type ?? 0) || 0)

const cover = computed(
  () => String(route.query.cover || '') || (songs.value[0] ? songCover(songs.value[0]) : '')
)
const ambient = computed(() => (cover.value ? coverAt(cover.value, 640) : ''))
const totalDuration = computed(() =>
  songs.value.reduce((sum, s) => sum + songDurationSeconds(s), 0)
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  songs.value = []
  try {
    songs.value = await fetchPlaylistTracks({
      listid: listid.value || undefined,
      globalCollectionId: gid.value || undefined,
      type: listType.value,
      page: 1,
      pagesize: 300
    })
    void fillMissingCovers(songs.value).catch(() => {
      /* 补封面失败不影响歌单 */
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '歌单加载失败'
  } finally {
    loading.value = false
  }
}

function playAll(): void {
  if (songs.value.length) void player.playQueue(songs.value, 0)
}

async function removeSong(song: SongItem): Promise<void> {
  if (deleting.value) return
  if (!listid.value) {
    deleteError.value = '只有自己的歌单才能删除歌曲'
    return
  }
  const fileid = Number(song.fileid)
  if (!Number.isFinite(fileid) || fileid <= 0) {
    deleteError.value = '这首歌缺少文件 ID，暂时无法删除'
    return
  }
  if (!window.confirm(`从歌单删除《${songTitle(song)}》？`)) return
  deleting.value = true
  deleteError.value = ''
  try {
    await removePlaylistTracks(listid.value, fileid)
    songs.value = songs.value.filter((item) => Number(item.fileid) !== fileid)
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : '删除失败'
  } finally {
    deleting.value = false
  }
}

onMounted(load)
watch(
  () => [route.params.id, route.query.listid, route.query.gid],
  () => {
    void load()
  }
)
</script>

<template>
  <div class="page playlist-page">
    <div v-if="ambient && !loading" class="page-ambient" aria-hidden="true">
      <img :src="ambient" alt="" />
    </div>

    <div v-if="loading" class="playlist-hero">
      <div class="skeleton playlist-cover" />
      <div class="playlist-info">
        <div class="skeleton" style="width: 48px; height: 11px; margin-bottom: 12px" />
        <div class="skeleton" style="width: 280px; height: 34px; margin-bottom: 12px" />
        <div class="skeleton" style="width: 140px; height: 13px" />
      </div>
    </div>

    <template v-else-if="error">
      <section class="state-panel">
        <PhWarningCircle :size="28" />
        <h2>歌单加载失败</h2>
        <p>{{ error }}</p>
        <button class="btn btn-secondary" type="button" @click="load">
          <PhArrowClockwise :size="15" /> 重试
        </button>
      </section>
    </template>

    <template v-else>
      <header class="playlist-hero">
        <CoverArt class="playlist-cover" :src="cover" :alt="title" :icon-size="42" />
        <div class="playlist-info">
          <p class="playlist-eyebrow">歌单</p>
          <h1 class="playlist-name">{{ title }}</h1>
          <p class="playlist-meta">
            {{ songs.length }} 首
            <template v-if="totalDuration > 0"> · {{ formatDuration(totalDuration) }}</template>
          </p>
          <div class="hero-actions">
            <button class="btn btn-primary" type="button" :disabled="!songs.length" @click="playAll">
              <PhPlay :size="13" weight="fill" /> 播放
            </button>
          </div>
        </div>
      </header>

      <p v-if="deleteError" class="form-error">{{ deleteError }}</p>

      <SongList
        :songs="songs"
        show-delete
        empty-text="这个歌单还没有歌曲"
        @delete-song="removeSong"
      />
    </template>
  </div>
</template>
