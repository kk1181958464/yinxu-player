<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhArrowClockwise,
  PhMagnifyingGlass,
  PhWarningCircle,
  PhX
} from '@phosphor-icons/vue'
import {
  searchSongsPage,
  fetchUserPlaylists,
  addSongToPlaylist,
  songTitle,
  type SongItem,
  type PlaylistItem
} from '../api/kugou'
import SongList from '../components/SongList.vue'

const RECENT_KEY = 'kugou_recent_searches'

const route = useRoute()
const router = useRouter()

const keyword = ref(String(route.query.q || ''))
const songs = ref<SongItem[]>([])
const loading = ref(false)
const error = ref('')
const searched = ref('')
const recent = ref<string[]>(loadRecent())
const inputEl = ref<HTMLInputElement | null>(null)

const page = ref(1)
const pageSize = ref(30)
const total = ref(0)
const pageLoading = ref(false)
const pageError = ref('')
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const addTarget = ref<SongItem | null>(null)
const playlists = ref<PlaylistItem[]>([])
const addLoading = ref(false)
const addBusy = ref(false)
const addError = ref('')
const addSuccess = ref('')

let debounce: ReturnType<typeof setTimeout> | null = null
let requestId = 0

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}

function saveRecent(q: string): void {
  const next = [q, ...recent.value.filter((x) => x !== q)].slice(0, 6)
  recent.value = next
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
}

function clearRecent(): void {
  recent.value = []
  localStorage.removeItem(RECENT_KEY)
}

async function runSearch(raw: string): Promise<void> {
  const q = raw.trim()
  if (!q) return
  const id = ++requestId
  loading.value = true
  pageLoading.value = false
  page.value = 1
  total.value = 0
  error.value = ''
  pageError.value = ''
  try {
    const result = await searchSongsPage(q, 1)
    if (id !== requestId) return
    songs.value = result.songs
    searched.value = q
    page.value = result.page
    pageSize.value = result.pagesize || 30
    total.value = result.total
    if (result.songs.length) saveRecent(q)
  } catch (e) {
    if (id !== requestId) return
    songs.value = []
    searched.value = q
    page.value = 1
    total.value = 0
    error.value = e instanceof Error ? e.message : '搜索失败'
  } finally {
    if (id === requestId) loading.value = false
  }
}

async function goToPage(target: number): Promise<void> {
  if (!searched.value || loading.value || pageLoading.value) return
  const nextPage = Math.min(Math.max(1, target), pageCount.value)
  if (nextPage === page.value) return
  const id = ++requestId
  pageLoading.value = true
  pageError.value = ''
  try {
    const result = await searchSongsPage(searched.value, nextPage, pageSize.value)
    if (id !== requestId) return
    songs.value = result.songs
    page.value = result.page
    pageSize.value = result.pagesize || pageSize.value
    total.value = result.total
    await nextTick()
    document.querySelector('.page-head')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  } catch (e) {
    if (id !== requestId) return
    pageError.value = e instanceof Error ? e.message : '翻页失败'
  } finally {
    if (id === requestId) pageLoading.value = false
  }
}

function clearAll(): void {
  keyword.value = ''
  songs.value = []
  error.value = ''
  pageError.value = ''
  searched.value = ''
  page.value = 1
  total.value = 0
  if (route.query.q) void router.replace({ name: 'search' })
  void nextTick(() => inputEl.value?.focus())
}

function pickRecent(q: string): void {
  keyword.value = q
  void runSearch(q)
  void router.replace({ name: 'search', query: { q } })
}

async function openAdd(song: SongItem): Promise<void> {
  addTarget.value = song
  addError.value = ''
  addSuccess.value = ''
  addLoading.value = true
  try {
    if (!playlists.value.length) {
      playlists.value = await fetchUserPlaylists()
    }
    if (!playlists.value.length) addError.value = '还没有可用的歌单'
  } catch (e) {
    addError.value = e instanceof Error ? e.message : '加载歌单失败'
  } finally {
    addLoading.value = false
  }
}

function closeAdd(): void {
  if (addBusy.value) return
  addTarget.value = null
}

async function choosePlaylist(playlist: PlaylistItem): Promise<void> {
  if (!addTarget.value || addBusy.value) return
  addBusy.value = true
  addError.value = ''
  try {
    await addSongToPlaylist(playlist.listid, addTarget.value)
    window.dispatchEvent(
      new CustomEvent('kugou:playlist-updated', {
        detail: { listid: String(playlist.listid) }
      })
    )
    addSuccess.value = `已添加到「${playlist.name}」`
    window.setTimeout(() => {
      if (addSuccess.value) closeAdd()
    }, 700)
  } catch (e) {
    addError.value = e instanceof Error ? e.message : '添加到歌单失败'
  } finally {
    addBusy.value = false
  }
}

watch(
  () => route.query.q,
  (q) => {
    const next = String(q || '')
    if (next && next !== keyword.value) keyword.value = next
  }
)

watch(keyword, (value) => {
  if (debounce) clearTimeout(debounce)
  const q = value.trim()
  if (!q) {
    songs.value = []
    error.value = ''
    pageError.value = ''
    searched.value = ''
    loading.value = false
    pageLoading.value = false
    page.value = 1
    total.value = 0
    return
  }
  debounce = setTimeout(() => {
    if (q !== searched.value) void runSearch(q)
  }, 420)
})

onMounted(() => {
  if (keyword.value.trim()) void runSearch(keyword.value.trim())
  void nextTick(() => inputEl.value?.focus())
})

onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce)
  requestId += 1
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1 class="page-title">搜索</h1>
      <p class="page-sub">搜索歌曲与艺人，结果会即时出现。</p>
    </header>

    <div class="search-field">
      <PhMagnifyingGlass :size="17" aria-hidden="true" />
      <input
        ref="inputEl"
        v-model="keyword"
        type="search"
        placeholder="搜索歌曲、艺人"
        aria-label="搜索歌曲、艺人"
        spellcheck="false"
        @keydown.enter="runSearch(keyword)"
      />
      <button v-if="keyword" class="search-clear" type="button" aria-label="清空搜索" @click="clearAll">
        <PhX :size="14" />
      </button>
    </div>

    <div v-if="loading" class="search-skeletons" aria-hidden="true">
      <div v-for="i in 6" :key="i" class="search-skeleton-row">
        <div class="skeleton" style="width: 40px; height: 40px; border-radius: 4px" />
        <div style="flex: 1">
          <div class="skeleton" style="height: 12px; width: 42%; margin-bottom: 8px" />
          <div class="skeleton" style="height: 10px; width: 24%" />
        </div>
      </div>
    </div>

    <section v-else-if="error" class="state-panel">
      <PhWarningCircle :size="28" />
      <h2>搜索失败</h2>
      <p>{{ error }}</p>
      <button class="btn btn-secondary" type="button" @click="runSearch(keyword)">
        <PhArrowClockwise :size="15" /> 重试
      </button>
    </section>

    <template v-else-if="searched">
      <div class="section-head">
        <h2>搜索结果</h2>
        <span class="section-meta">{{ total ? `共 ${total} 首` : songs.length ? `${songs.length} 首` : '无结果' }}</span>
      </div>
      <SongList
        v-if="songs.length"
        :songs="songs"
        show-add
        empty-text="没有找到相关歌曲，试试别的关键词"
        @add-song="openAdd"
      />
      <nav v-if="songs.length && total > pageSize" class="search-pager" aria-label="搜索结果分页">
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="page <= 1 || loading || pageLoading"
          @click="goToPage(page - 1)"
        >
          上一页
        </button>
        <span class="search-pager-info">
          {{ pageLoading ? '加载中…' : `第 ${page} / ${pageCount} 页` }}
        </span>
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="page >= pageCount || loading || pageLoading"
          @click="goToPage(page + 1)"
        >
          下一页
        </button>
      </nav>
      <p v-if="pageError" class="form-error search-page-error">{{ pageError }}</p>
      <section v-if="!songs.length" class="state-panel">
        <PhMagnifyingGlass :size="26" />
        <h2>没有找到「{{ searched }}」</h2>
        <p>换一个关键词，或检查是否有错别字。</p>
      </section>
    </template>

    <template v-else>
      <section v-if="recent.length" class="search-recent">
        <div class="section-head">
          <h2>最近搜索</h2>
          <button class="text-btn" type="button" @click="clearRecent">清空</button>
        </div>
        <div class="search-chips">
          <button
            v-for="q in recent"
            :key="q"
            class="search-chip"
            type="button"
            @click="pickRecent(q)"
          >
            {{ q }}
          </button>
        </div>
      </section>
      <section v-else class="state-panel">
        <PhMagnifyingGlass :size="26" />
        <h2>搜索曲库</h2>
        <p>输入歌名或艺人，搜索结果会即时出现。</p>
      </section>
    </template>
  </div>

  <Teleport to="body">
    <div v-if="addTarget" class="playlist-picker-layer" @click.self="closeAdd">
      <section
        class="playlist-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-picker-title"
      >
        <header class="playlist-picker-head">
          <div>
            <h3 id="playlist-picker-title">添加到歌单</h3>
            <p>{{ songTitle(addTarget) }}</p>
          </div>
          <button class="icon-btn" type="button" aria-label="关闭" @click="closeAdd">
            <PhX :size="16" />
          </button>
        </header>

        <div v-if="addLoading" class="playlist-picker-state">正在加载歌单…</div>
        <div v-else-if="playlists.length" class="playlist-picker-list">
          <button
            v-for="p in playlists"
            :key="p.listid"
            class="playlist-picker-row"
            type="button"
            :disabled="addBusy"
            @click="choosePlaylist(p)"
          >
            <span class="playlist-picker-art">
              <img v-if="p.cover" :src="p.cover" alt="" />
              <span v-else>♪</span>
            </span>
            <span class="playlist-picker-text">
              <strong>{{ p.name }}</strong>
              <small>{{ p.count }} 首</small>
            </span>
            <span class="playlist-picker-add">{{ addBusy ? '添加中…' : '添加' }}</span>
          </button>
        </div>
        <div v-else class="playlist-picker-state">还没有可用的歌单</div>

        <p v-if="addError" class="form-error">{{ addError }}</p>
        <p v-if="addSuccess" class="playlist-picker-success">{{ addSuccess }}</p>
      </section>
    </div>
  </Teleport>
</template>
