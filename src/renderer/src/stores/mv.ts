import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchMvUrl, songMvHash, type SongItem } from '../api/kugou'
import { usePlayerStore } from './player'

export const useMvStore = defineStore('mv', () => {
  const player = usePlayerStore()
  const current = ref<SongItem | null>(null)
  const url = ref('')
  const loading = ref(false)
  const error = ref('')
  let requestId = 0

  async function open(song: SongItem): Promise<void> {
    if (player.playing) player.toggle()
    const hash = songMvHash(song)
    const id = ++requestId
    current.value = song
    url.value = ''
    error.value = ''
    if (!hash) {
      loading.value = false
      error.value = '这首歌没有 MV'
      return
    }
    loading.value = true
    try {
      const nextUrl = await fetchMvUrl(hash)
      if (id !== requestId) return
      url.value = nextUrl
    } catch (e) {
      if (id !== requestId) return
      error.value = e instanceof Error ? e.message : 'MV 加载失败'
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  function setError(message: string): void {
    error.value = message
    url.value = ''
    loading.value = false
  }

  function close(): void {
    requestId += 1
    current.value = null
    url.value = ''
    loading.value = false
    error.value = ''
  }

  return { current, url, loading, error, open, setError, close }
})
