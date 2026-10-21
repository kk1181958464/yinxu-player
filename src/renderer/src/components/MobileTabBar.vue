<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { PhCrown, PhHouse, PhMagnifyingGlass, PhUser } from '@phosphor-icons/vue'

const route = useRoute()
const router = useRouter()

const tabs = [
  { name: 'home', label: '首页', icon: PhHouse },
  { name: 'search', label: '搜索', icon: PhMagnifyingGlass },
  { name: 'vip', label: '会员', icon: PhCrown },
  { name: 'library', label: '我的', icon: PhUser }
] as const

function go(name: (typeof tabs)[number]['name']): void {
  if (route.name === name) return
  void router.push({ name })
}

function active(name: string): boolean {
  if (name === 'library') return route.name === 'library' || route.name === 'playlist'
  return route.name === name
}
</script>

<template>
  <nav class="mobile-tabbar" aria-label="底部导航">
    <button
      v-for="tab in tabs"
      :key="tab.name"
      class="mobile-tab"
      type="button"
      :class="{ active: active(tab.name) }"
      :aria-current="active(tab.name) ? 'page' : undefined"
      @click="go(tab.name)"
    >
      <component :is="tab.icon" :size="20" :weight="active(tab.name) ? 'fill' : 'regular'" />
      <span>{{ tab.label }}</span>
    </button>
  </nav>
</template>
