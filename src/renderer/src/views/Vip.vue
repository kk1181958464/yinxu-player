<script setup lang="ts">
import { onMounted } from 'vue'
import {
  PhArrowClockwise,
  PhCheckCircle,
  PhCrown,
  PhWarningCircle
} from '@phosphor-icons/vue'
import { useVipStore } from '../stores/vip'

const vip = useVipStore()

onMounted(() => {
  void vip.refreshVip()
})

function onFutureDays(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  vip.patchSettings({ futureDays: value })
}

function onAdHours(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  vip.patchSettings({ adHoursCount: value })
}

function onDelay(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  vip.patchSettings({ delaySeconds: value })
}

function onReceiveDay(e: Event): void {
  vip.patchSettings({ receiveDay: (e.target as HTMLInputElement).value })
}

function toggleEnabled(): void {
  vip.patchSettings({ enabled: !vip.settings.enabled })
  if (vip.settings.enabled) vip.scheduleAutoClaim()
  else vip.cancelSchedule()
}

function toggleUpgrade(): void {
  vip.patchSettings({ autoUpgrade: !vip.settings.autoUpgrade })
}

function toggleNotify(): void {
  vip.patchSettings({ notify: !vip.settings.notify })
}
</script>

<template>
  <div class="page vip-page">
    <header class="page-head">
      <h1 class="page-title">会员</h1>
      <p class="page-sub">领取酷狗概念版每日畅听会员，并升级概念会员时长。</p>
    </header>

    <section class="vip-status-grid">
      <article
        v-for="p in vip.products"
        :key="p.key"
        class="vip-card"
        :class="{ 'vip-card-on': p.active }"
      >
        <p class="vip-card-label">{{ p.label }}</p>
        <p class="vip-card-state">{{ p.active ? '生效中' : '未生效' }}</p>
        <p class="vip-card-meta">{{ p.active && p.endTime ? `到期 ${p.endTime}` : '完成领取后会显示到期时间' }}</p>
      </article>
      <article v-if="!vip.products.length" class="vip-card vip-card-span">
        <p class="vip-card-label">会员状态</p>
        <p class="vip-card-state">{{ vip.vipLoading ? '查询中' : vip.vipText }}</p>
        <p class="vip-card-meta">登录概念版账号后即可查询畅听与概念会员。</p>
      </article>
    </section>

    <div class="vip-toolbar">
      <button
        class="btn btn-secondary"
        type="button"
        :disabled="vip.vipLoading"
        @click="vip.refreshVip()"
      >
        <PhArrowClockwise :size="15" :class="{ spinning: vip.vipLoading }" />
        刷新状态
      </button>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="vip.claiming"
        @click="vip.claimNow()"
      >
        <PhCrown :size="15" weight="fill" />
        {{ vip.claiming ? '执行中…' : '立即领取' }}
      </button>
    </div>

    <p v-if="vip.progress" class="vip-progress">{{ vip.progress }}</p>

    <section class="vip-panel">
      <div class="vip-stats">
        <p>今日畅听已领：{{ vip.todayClaimed ? '是' : '否' }}</p>
        <p>累计已领 {{ vip.claimedCount }} 天，已升级概念会员 {{ vip.persist.upgradedCount }} 天</p>
        <p>今日广告时长：{{ vip.adDoneLabel }}</p>
        <p v-if="vip.persist.lastResult">最近结果：{{ vip.persist.lastResult }}</p>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>自动领取</h2>
      </div>

      <div class="vip-rows">
        <div class="vip-row">
          <div class="vip-row-copy">
            <p class="vip-row-title">启动时自动领取</p>
            <p class="vip-row-desc">登录后按下方延迟自动执行一轮领取</p>
          </div>
          <button
            class="switch"
            type="button"
            role="switch"
            aria-label="启动时自动领取"
            :aria-checked="vip.settings.enabled"
            @click="toggleEnabled"
          >
            <span class="switch-knob" />
          </button>
        </div>

        <div class="vip-row vip-row-stack">
          <div class="vip-row-copy">
            <p class="vip-row-title">连续领取天数</p>
            <p class="vip-row-desc">从今天起连续领取未来多天的畅听会员（0 为只领今天）</p>
          </div>
          <label class="vip-range">
            <input
              type="range"
              min="0"
              max="31"
              step="1"
              :value="vip.settings.futureDays"
              @input="onFutureDays"
            />
            <span>{{ vip.settings.futureDays }} 天</span>
          </label>
        </div>

        <div class="vip-row vip-row-stack">
          <div class="vip-row-copy">
            <p class="vip-row-title">每日广告领时长</p>
            <p class="vip-row-desc">
              每次约 +3 小时概念会员，最多 8 次。间隔约 35 秒，全部完成大约 4 到 5 分钟（0 为关闭）
            </p>
          </div>
          <label class="vip-range">
            <input
              type="range"
              min="0"
              max="8"
              step="1"
              :value="vip.settings.adHoursCount"
              @input="onAdHours"
            />
            <span>{{ vip.settings.adHoursCount }} 次</span>
          </label>
        </div>

        <div class="vip-row">
          <div class="vip-row-copy">
            <p class="vip-row-title">每日升级概念会员</p>
            <p class="vip-row-desc">每天自动升级 1 天概念会员，服务端限制每日一次</p>
          </div>
          <button
            class="switch"
            type="button"
            role="switch"
            aria-label="每日升级概念会员"
            :aria-checked="vip.settings.autoUpgrade"
            @click="toggleUpgrade"
          >
            <span class="switch-knob" />
          </button>
        </div>

        <div class="vip-row vip-row-stack">
          <div class="vip-row-copy">
            <p class="vip-row-title">启动延迟</p>
            <p class="vip-row-desc">登录完成后等待若干秒再开始自动领取</p>
          </div>
          <label class="vip-range">
            <input
              type="range"
              min="0"
              max="60"
              step="1"
              :value="vip.settings.delaySeconds"
              @input="onDelay"
            />
            <span>{{ vip.settings.delaySeconds }} 秒</span>
          </label>
        </div>

        <div class="vip-row">
          <div class="vip-row-copy">
            <p class="vip-row-title">显示通知</p>
            <p class="vip-row-desc">领取结果用顶部提示展示</p>
          </div>
          <button
            class="switch"
            type="button"
            role="switch"
            aria-label="显示通知"
            :aria-checked="vip.settings.notify"
            @click="toggleNotify"
          >
            <span class="switch-knob" />
          </button>
        </div>

        <div class="vip-row">
          <div class="vip-row-copy">
            <p class="vip-row-title">指定领取日期</p>
            <p class="vip-row-desc">留空 auto 按日期序列连续领取，也可填写如 2026-10-20</p>
          </div>
          <input
            class="vip-date-input"
            type="text"
            :value="vip.settings.receiveDay"
            placeholder="auto"
            spellcheck="false"
            @change="onReceiveDay"
          />
        </div>
      </div>
    </section>

    <section v-if="vip.persist.history.length" class="section">
      <div class="section-head">
        <h2>最近记录</h2>
      </div>
      <ul class="vip-history">
        <li v-for="(entry, i) in vip.persist.history.slice(0, 8)" :key="i" class="vip-history-item">
          <PhCheckCircle v-if="entry.ok" :size="15" class="vip-history-ok" />
          <PhWarningCircle v-else :size="15" class="vip-history-fail" />
          <span class="vip-history-time">{{ entry.time }}</span>
          <span class="vip-history-msg">{{ entry.message }}</span>
        </li>
      </ul>
    </section>

    <section class="legal">
      <h2>说明</h2>
      <p>
        领取活动由酷狗服务器控制。日期早于今天会被拒绝；当天未满足听歌条件时服务端会拒绝。
        自动领取仅在本机执行，凭证不会上传。领取逻辑参考
        echo-auto-vip，请遵守音乐平台用户协议，仅供学习研究使用。
      </p>
    </section>
  </div>
</template>
