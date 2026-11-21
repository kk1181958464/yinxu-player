<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  PhArrowClockwise,
  PhCheckCircle,
  PhDownloadSimple,
  PhWarningCircle,
  PhX
} from '@phosphor-icons/vue'
import { useUpdateStore } from '../stores/update'
import { isElectron } from '../utils/platform'

const update = useUpdateStore()
const desktop = isElectron()

const phaseLabel = computed(() => {
  switch (update.phase) {
    case 'checking':
      return '正在检查'
    case 'available':
      return '发现新版本'
    case 'downloading':
      return '正在下载'
    case 'downloaded':
      return '下载完成'
    case 'latest':
      return '已是最新版本'
    case 'error':
      return '更新失败'
    default:
      return '检查更新'
  }
})

onMounted(() => {
  void update.autoCheck()
})

async function primaryAction(): Promise<void> {
  if (update.phase === 'available') {
    await update.download()
    return
  }
  if (update.phase === 'downloaded' && desktop) {
    await update.install()
    return
  }
  await update.check()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="update.open" class="update-layer" @click.self="update.closePanel()">
      <section class="update-dialog" role="dialog" aria-modal="true" aria-label="在线更新">
        <header class="update-head">
          <div class="update-heading">
            <span class="update-icon"><PhDownloadSimple :size="20" /></span>
            <div>
              <h3>在线更新</h3>
              <p>从 GitHub 获取最新安装包</p>
            </div>
          </div>
          <button class="icon-btn" type="button" aria-label="关闭" @click="update.closePanel()">
            <PhX :size="16" />
          </button>
        </header>

        <div class="update-version-row">
          <span>当前版本 <strong>v{{ update.currentVersion || '…' }}</strong></span>
          <span v-if="update.latestVersion" class="update-latest">
            最新 <strong>v{{ update.latestVersion }}</strong>
          </span>
        </div>

        <div class="update-status" :class="'update-status-' + update.phase">
          <PhCheckCircle v-if="update.phase === 'latest'" :size="18" />
          <PhWarningCircle v-else-if="update.phase === 'error'" :size="18" />
          <PhDownloadSimple v-else :size="18" />
          <span>{{ phaseLabel }}</span>
          <span v-if="update.message" class="update-message">{{ update.message }}</span>
        </div>

        <div v-if="update.phase === 'downloading'" class="update-progress">
          <span :style="{ width: update.progress + '%' }" />
        </div>

        <footer class="update-actions">
          <button
            v-if="update.phase === 'downloaded' && !desktop"
            class="btn btn-primary"
            type="button"
            @click="update.closePanel()"
          >
            知道了
          </button>
          <button
            v-else
            class="btn btn-primary"
            type="button"
            :disabled="update.phase === 'downloading' || update.phase === 'checking'"
            @click="primaryAction"
          >
            <PhArrowClockwise
              v-if="update.phase === 'checking'"
              :size="15"
              class="spinning"
            />
            <PhDownloadSimple v-else :size="15" />
            {{
              update.phase === 'available'
                ? '下载更新'
                : update.phase === 'downloaded'
                  ? '立即安装'
                  : update.phase === 'checking'
                    ? '检查中…'
                    : update.phase === 'downloading'
                      ? '下载中…'
                      : '检查更新'
            }}
          </button>
          <button class="btn btn-ghost" type="button" @click="update.closePanel()">
            关闭
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
