<script setup lang="ts">
import { computed } from 'vue'
import { PhFilmSlate, PhWarningCircle, PhX } from '@phosphor-icons/vue'
import { songArtist, songTitle } from '../api/kugou'
import { useMvStore } from '../stores/mv'

const mv = useMvStore()

const title = computed(() => (mv.current ? songTitle(mv.current) : ''))
const artist = computed(() => (mv.current ? songArtist(mv.current) : ''))

function onVideoError(): void {
  mv.setError('MV 加载失败，请稍后再试')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="mv.current" class="mv-layer" @click.self="mv.close()">
      <section class="mv-dialog" role="dialog" aria-modal="true" aria-label="MV 播放">
        <header class="mv-head">
          <div class="mv-heading">
            <PhFilmSlate :size="20" />
            <div>
              <h3>{{ title }}</h3>
              <p>{{ artist }}</p>
            </div>
          </div>
          <button class="icon-btn" type="button" aria-label="关闭 MV" @click="mv.close()">
            <PhX :size="16" />
          </button>
        </header>

        <div v-if="mv.loading" class="mv-state">MV 加载中…</div>
        <div v-else-if="mv.error" class="mv-state mv-error">
          <PhWarningCircle :size="22" />
          <p>{{ mv.error }}</p>
        </div>
        <video
          v-else-if="mv.url"
          class="mv-video"
          :src="mv.url"
          controls
          autoplay
          playsinline
          @error="onVideoError"
        />
      </section>
    </div>
  </Teleport>
</template>
