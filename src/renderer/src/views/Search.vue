<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhArrowClockwise,
  PhMagnifyingGlass,
  PhWarningCircle,
  PhX
} from '@phosphor-icons/vue'
import { searchSongs, type SongItem } from '../api/kugou'
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
  error.value = ''
  try {
    const result = await searchSongs(q)
    if (id !== requestId) return
    songs.value = result
    searched.value = q
    if (result.length) saveRecent(q)
  } catch (e) {
    if (id !== requestId) return
    songs.value = []
    searched.value = q
    error.value = e instanceof Error ? e.message : '搜索失败'
  } finally {
    if (id === requestId) loading.value = false
  }
}

function clearAll(): void {
  keyword.value = ''
  songs.value = []
  error.value = ''
  searched.value = ''
  if (route.query.q) void router.replace({ name: 'search' })
  void nextTick(() => inputEl.value?.focus())
}

function pickRecent(q: string): void {
  keyword.value = q
  void runSearch(q)
  void router.replace({ name: 'search', query: { q } })
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
    searched.value = ''
    loading.value = false
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
        <span class="section-meta">{{ songs.length ? `${songs.length} 首` : '无结果' }}</span>
      </div>
      <SongList
        v-if="songs.length"
        :songs="songs"
        empty-text="没有找到相关歌曲，试试别的关键词"
      />
      <section v-else class="state-panel">
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
</template>
