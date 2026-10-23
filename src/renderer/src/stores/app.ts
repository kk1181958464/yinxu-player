import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  hasLoginToken,
  clearAuthCookies,
  registerDev,
  initApiBase,
  fetchUserDetail,
  getStoredUserid,
  fetchUserPlaylists,
  type PlaylistItem
} from '../api/kugou'

const USER_CACHE_KEY = 'kugou_user_profile'

interface CachedProfile {
  nickname: string
  pic: string
  userid: string
}

function loadCachedProfile(): CachedProfile {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY)
    if (!raw) return { nickname: '', pic: '', userid: '' }
    const p = JSON.parse(raw) as Partial<CachedProfile>
    return {
      nickname: p.nickname || '',
      pic: p.pic || '',
      userid: p.userid || ''
    }
  } catch {
    return { nickname: '', pic: '', userid: '' }
  }
}

function saveCachedProfile(profile: CachedProfile): void {
  localStorage.setItem(USER_CACHE_KEY, JSON.stringify(profile))
}

export const useAppStore = defineStore('app', () => {
  const ready = ref(false)
  const apiReady = ref(false)
  const bootError = ref('')
  const loggedIn = ref(false)

  const cached = loadCachedProfile()
  const nickname = ref(cached.nickname)
  const userPic = ref(cached.pic)
  const userid = ref(cached.userid)

  const playlists = ref<PlaylistItem[]>([])
  const playlistsLoading = ref(false)
  const playlistsError = ref('')
  let playlistsEpoch = 0

  const displayName = computed(() => nickname.value || '音乐爱好者')

  function resetProfile(): void {
    nickname.value = ''
    userPic.value = ''
    userid.value = ''
  }

  async function bootstrap(): Promise<void> {
    bootError.value = ''
    try {
      let lastError: unknown = null
      // 窗口先显示，本地 API 在窗口 ready-to-show 之后才启动；
      // 这里短暂重试，避免用户看到“无法连接音乐服务”。
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          await initApiBase()
          await registerDev()
          apiReady.value = true
          lastError = null
          break
        } catch (e) {
          lastError = e
          apiReady.value = false
          if (attempt < 19) {
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
        }
      }
      if (!apiReady.value) {
        throw lastError instanceof Error ? lastError : new Error('API not ready')
      }

      loggedIn.value = hasLoginToken()
      if (loggedIn.value) {
        await refreshLogin()
        void loadPlaylists()
      } else {
        resetProfile()
      }
    } catch (e) {
      apiReady.value = false
      bootError.value = '无法连接音乐服务，请稍后重试'
      console.error('[app] bootstrap failed', e)
    } finally {
      ready.value = true
    }
  }

  async function retryBootstrap(): Promise<void> {
    ready.value = false
    await bootstrap()
  }

  /** 校验并刷新当前登录态；返回是否已登录 */
  async function refreshLogin(): Promise<boolean> {
    loggedIn.value = hasLoginToken()
    if (!loggedIn.value) {
      resetProfile()
      localStorage.removeItem(USER_CACHE_KEY)
      return false
    }
    try {
      const detail = await fetchUserDetail()
      if (!loggedIn.value) return false
      nickname.value = detail.nickname || nickname.value || '已登录'
      userPic.value = detail.pic || userPic.value || ''
      userid.value = detail.userid || getStoredUserid() || userid.value || ''
      saveCachedProfile({
        nickname: nickname.value,
        pic: userPic.value,
        userid: userid.value
      })
    } catch (e) {
      console.warn('[app] user detail failed', e)
      if (!loggedIn.value) return false
      userid.value = getStoredUserid() || userid.value || ''
      if (!nickname.value) nickname.value = '已登录'
    }
    return true
  }

  /** 登录成功后进入应用：刷新资料并加载歌单 */
  async function completeLogin(): Promise<void> {
    const ok = await refreshLogin()
    if (ok) await loadPlaylists()
  }

  async function loadPlaylists(): Promise<void> {
    if (!loggedIn.value) {
      playlists.value = []
      playlistsError.value = ''
      return
    }
    const epoch = ++playlistsEpoch
    playlistsLoading.value = true
    playlistsError.value = ''
    try {
      const result = await fetchUserPlaylists(1, 50)
      if (epoch !== playlistsEpoch || !loggedIn.value) return
      playlists.value = result
    } catch (e) {
      if (epoch !== playlistsEpoch || !loggedIn.value) return
      playlists.value = []
      playlistsError.value = e instanceof Error ? e.message : '歌单加载失败'
    } finally {
      if (epoch === playlistsEpoch) playlistsLoading.value = false
    }
  }

  async function logout(): Promise<void> {
    playlistsEpoch += 1
    clearAuthCookies()
    localStorage.removeItem(USER_CACHE_KEY)
    loggedIn.value = false
    resetProfile()
    playlists.value = []
    playlistsError.value = ''
    playlistsLoading.value = false
  }

  return {
    ready,
    apiReady,
    bootError,
    loggedIn,
    nickname,
    userPic,
    userid,
    displayName,
    playlists,
    playlistsLoading,
    playlistsError,
    bootstrap,
    retryBootstrap,
    refreshLogin,
    completeLogin,
    loadPlaylists,
    logout
  }
})
