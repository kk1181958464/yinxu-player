import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/** 应用内前进/后退历史（工具栏按钮用） */
export function useNavHistory() {
  const router = useRouter()
  const route = useRoute()

  const stack = ref<string[]>([route.fullPath])
  const index = ref(0)
  let suppress = false

  const removeGuard = router.afterEach((to) => {
    if (suppress) {
      suppress = false
      return
    }
    if (to.fullPath === stack.value[index.value]) return
    stack.value = stack.value.slice(0, index.value + 1)
    stack.value.push(to.fullPath)
    index.value = stack.value.length - 1
  })

  const canGoBack = computed(() => index.value > 0)
  const canGoForward = computed(() => index.value < stack.value.length - 1)

  function go(offset: number): void {
    const next = index.value + offset
    if (next < 0 || next >= stack.value.length) return
    index.value = next
    suppress = true
    void router.push(stack.value[next])
  }

  function back(): void {
    go(-1)
  }

  function forward(): void {
    go(1)
  }

  onBeforeUnmount(() => {
    removeGuard()
  })

  return { canGoBack, canGoForward, back, forward }
}
