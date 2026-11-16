<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import api from '@/api'

const props = defineProps<{ accountId: string | number }>()
const priority = defineModel<number[]>({ required: true })
interface Seed { seedId: number, name: string, count: number, image?: string }
const seeds = ref<Seed[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')
const expanded = ref(false)
const dragging = ref<number | null>(null)
const list = ref<HTMLElement>()
const dropTarget = ref<number | null>(null)
const dropSide = ref<'before' | 'after'>('before')
const pointer = ref({ x: 0, y: 0, offsetX: 0, offsetY: 0, width: 0, height: 0 })
let pending: { id: number, pointerId: number, x: number, y: number, element: HTMLElement } | null = null
let scrollFrame = 0
const draggedSeed = computed(() => seeds.value.find(seed => seed.seedId === dragging.value))
let requestId = 0
onBeforeUnmount(() => {
  requestId += 1
  cancelDrag()
})
const ordered = computed(() => {
  const ids = [...priority.value, ...seeds.value.map(s => s.seedId).filter(id => !priority.value.includes(id))]
  return ids.map(id => seeds.value.find(s => s.seedId === id)).filter((s): s is Seed => !!s)
})
const visibleSeeds = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return ordered.value.map((seed, index) => ({ seed, rank: index + 1 }))
    .filter(({ seed }) => !query || seed.name.toLocaleLowerCase().includes(query) || String(seed.seedId).includes(query))
})
async function refresh() {
  const request = ++requestId
  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/api/bag/seeds', { headers: { 'x-account-id': props.accountId } })
    if (request !== requestId)
      return
    if (!res.data.ok)
      throw new Error(res.data.error || '读取背包失败')
    seeds.value = res.data.data.seeds
    priority.value = [...priority.value, ...res.data.data.priority.filter((id: number) => !priority.value.includes(id))]
  }
  catch (e) {
    if (request === requestId)
      error.value = e instanceof Error ? e.message : '读取背包失败'
  }
  finally {
    if (request === requestId)
      loading.value = false
  }
}
watch(() => props.accountId, () => {
  seeds.value = []
  search.value = ''
  cancelDrag()
  void refresh()
}, { immediate: true })
function move(id: number, target: number) {
  if (id === target)
    return
  const ids = [...priority.value]
  const from = ids.indexOf(id)
  const to = ids.indexOf(target)
  if (from < 0 || to < 0)
    return
  ids.splice(from, 1)
  ids.splice(to, 0, id)
  priority.value = ids
}
function moveByKeyboard(event: KeyboardEvent, id: number, rank: number) {
  const direction = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key]
  if (direction === undefined)
    return
  event.preventDefault()
  const target = ordered.value[rank - 1 + direction]
  if (target)
    move(id, target.seedId)
}
function cancelDrag() {
  cancelAnimationFrame(scrollFrame)
  window.removeEventListener('keydown', escapeDrag)
  const previous = pending
  pending = null
  dragging.value = null
  dropTarget.value = null
  if (previous?.element.hasPointerCapture(previous.pointerId))
    previous.element.releasePointerCapture(previous.pointerId)
}
function escapeDrag(event: KeyboardEvent) {
  if (event.key === 'Escape')
    cancelDrag()
}
function updateDropTarget() {
  const { x, y } = pointer.value
  const container = list.value
  const bounds = container?.getBoundingClientRect()
  dropTarget.value = null
  if (!container || !bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom)
    return
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-seed-id]'))
    .map(element => ({ id: Number(element.dataset.seedId), rect: element.getBoundingClientRect() }))
  // Select the nearest grid row, including the empty space between rows.
  const nearest = cards.reduce<typeof cards[number] | undefined>((best, card) => {
    const distance = Math.abs(y - (card.rect.top + card.rect.height / 2))
    return !best || distance < Math.abs(y - (best.rect.top + best.rect.height / 2)) ? card : best
  }, undefined)
  if (!nearest)
    return
  const row = cards.filter(card => Math.abs(card.rect.top - nearest.rect.top) < 2)
  // Card centers divide insertion slots, so horizontal gaps remain valid targets.
  const next = row.find(card => x < card.rect.left + card.rect.width / 2)
  const target = next || row[row.length - 1]
  if (target) {
    dropTarget.value = target.id
    dropSide.value = next ? 'before' : 'after'
  }
}
function insertAtDropTarget() {
  const source = dragging.value
  const target = dropTarget.value
  if (source === null || target === null || source === target)
    return
  const ids = priority.value.filter(id => id !== source)
  const index = ids.indexOf(target)
  if (index < 0 || !priority.value.includes(source))
    return
  ids.splice(index + (dropSide.value === 'after' ? 1 : 0), 0, source)
  priority.value = ids
}
function autoScroll() {
  if (dragging.value === null)
    return
  const bounds = list.value?.getBoundingClientRect()
  const { x, y } = pointer.value
  if (bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top - 32 && y <= bounds.bottom + 32) {
    const speed = y < bounds.top + 40 ? -8 : y > bounds.bottom - 40 ? 8 : 0
    if (speed) {
      list.value?.scrollBy(0, speed)
      updateDropTarget()
    }
  }
  scrollFrame = requestAnimationFrame(autoScroll)
}
function start(event: PointerEvent, id: number) {
  if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button'))
    return
  cancelDrag()
  const element = event.currentTarget as HTMLElement
  const bounds = element.getBoundingClientRect()
  pending = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, element }
  pointer.value = { x: event.clientX, y: event.clientY, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, width: bounds.width, height: bounds.height }
  element.setPointerCapture(event.pointerId)
  window.addEventListener('keydown', escapeDrag)
}
function drag(event: PointerEvent) {
  if (!pending || pending.pointerId !== event.pointerId)
    return
  pointer.value.x = event.clientX
  pointer.value.y = event.clientY
  if (dragging.value === null) {
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 5)
      return
    dragging.value = pending.id
    scrollFrame = requestAnimationFrame(autoScroll)
  }
  updateDropTarget()
}
function finishDrag(event: PointerEvent) {
  if (!pending || pending.pointerId !== event.pointerId)
    return
  if (dragging.value !== null) {
    pointer.value.x = event.clientX
    pointer.value.y = event.clientY
    updateDropTarget()
    insertAtDropTarget()
  }
  cancelDrag()
}
watch(search, cancelDrag)
watch(expanded, cancelDrag)
</script>

<template>
  <section class="border border-gray-200 rounded-lg p-2.5 dark:border-gray-700">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button type="button" class="min-h-8 flex items-center gap-2 text-sm font-medium" :aria-expanded="expanded" @click="expanded = !expanded">
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3 w-3 transition-transform" :class="{ 'rotate-90': expanded }"><path d="m6 3 5 5-5 5" /></svg>
        背包种植优先级
        <span class="text-xs text-gray-500 font-normal">{{ loading ? '读取中…' : error ? '读取失败' : `共 ${ordered.length} 种` }}</span>
      </button>
      <div v-if="expanded" class="ml-auto flex items-center gap-2">
        <input v-model="search" type="search" aria-label="搜索背包种子" placeholder="搜索名称 / ID" class="h-8 w-36 border border-gray-200 rounded-md bg-transparent px-2 text-xs outline-none focus:border-[var(--theme-primary)] sm:w-44 dark:border-gray-600">
        <span v-if="search.trim()" class="text-xs text-gray-500">{{ visibleSeeds.length }} 项</span>
        <button type="button" class="h-8 shrink-0 text-xs text-[var(--theme-primary)] disabled:opacity-50" :disabled="loading || dragging !== null" @click="refresh">
          {{ loading ? '读取中…' : '刷新' }}
        </button>
        <span tabindex="0" aria-label="按从左到右、从上到下的顺序种植；拖动或置顶调整，保存设置后生效。四格作物由四格优先设置控制。" title="按从左到右、从上到下的顺序种植；拖动或置顶调整，保存设置后生效。四格作物由四格优先设置控制。" class="i-carbon-information h-4 w-4 shrink-0 text-gray-400" />
      </div>
    </div>
    <div v-show="expanded" class="mt-2">
      <p v-if="error" role="alert" class="text-sm text-red-500">
        {{ error }}
      </p>
      <p v-else-if="loading" class="py-4 text-center text-sm text-gray-500">
        正在读取背包…
      </p>
      <p v-else-if="!ordered.length" class="py-4 text-center text-sm text-gray-500">
        暂无单格种子，将使用第二优先策略。
      </p>
      <template v-else>
        <div ref="list" class="seed-priority-list max-h-96 overflow-y-auto overscroll-contain px-2">
          <p v-if="!visibleSeeds.length" class="py-6 text-center text-sm text-gray-500">
            没有匹配的种子
          </p>
          <div class="seed-priority-grid">
            <div v-for="{ seed, rank } in visibleSeeds" :key="seed.seedId" :data-seed-id="seed.seedId" tabindex="0" :aria-label="`${seed.name}，第${rank}名，可拖动或使用方向键调整顺序`" class="relative min-w-0 cursor-grab touch-none select-none border rounded-lg bg-gray-50 p-2 active:cursor-grabbing dark:bg-gray-800" @pointerdown="start($event, seed.seedId)" @pointermove="drag" @pointerup="finishDrag" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag" @keydown="moveByKeyboard($event, seed.seedId, rank)" :class="{
                'seed-drag-placeholder': dragging === seed.seedId,
                'seed-drop-before': dropTarget === seed.seedId && dropSide === 'before',
                'seed-drop-after': dropTarget === seed.seedId && dropSide === 'after',
                'border-gray-200 dark:border-gray-700': dragging !== seed.seedId,
              }">
              <div class="flex items-center justify-between gap-1">
                <span class="text-xs text-gray-500 tabular-nums">#{{ rank }}</span>
                <button type="button" class="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded text-[var(--theme-primary)] hover:bg-gray-200 disabled:cursor-default disabled:text-gray-400 disabled:opacity-40 dark:hover:bg-gray-700" :disabled="rank === 1" :aria-label="`置顶${seed.name}`" :title="rank === 1 ? '已置顶' : '置顶'" @pointerdown.stop @keydown.stop @click.stop="move(seed.seedId, ordered[0]!.seedId)">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
                    <path d="M5 4h14M12 20V8m-5 5 5-5 5 5" />
                  </svg>
                </button>
              </div>
              <div class="flex flex-col items-center gap-1 pb-2">
                <div class="grid h-10 w-10 place-items-center">
                  <img v-if="seed.image" :src="seed.image" alt="" class="h-10 w-10 object-contain" draggable="false">
                  <span v-else class="i-carbon-sprout text-2xl text-gray-400" />
                </div>
                <div class="w-full truncate text-center text-sm font-medium" :title="seed.name">{{ seed.name }}</div>
                <span class="text-xs text-gray-500">库存 {{ seed.count }}</span>
              </div>

            </div>
          </div>
        </div>
      </template>
    </div>
    <Teleport to="body">
      <div v-if="draggedSeed" aria-hidden="true" class="seed-drag-preview fixed border rounded-lg bg-gray-50 p-2 text-gray-900 dark:bg-gray-800 dark:text-gray-100" :style="{ left: `${pointer.x - pointer.offsetX}px`, top: `${pointer.y - pointer.offsetY}px`, width: `${pointer.width}px`, height: `${pointer.height}px` }">
        <div class="h-7 text-xs text-gray-500">#{{ ordered.findIndex(seed => seed.seedId === draggedSeed?.seedId) + 1 }}</div>
        <div class="flex flex-col items-center gap-1 pb-2">
          <div class="grid h-10 w-10 place-items-center">
            <img v-if="draggedSeed.image" :src="draggedSeed.image" alt="" class="h-10 w-10 object-contain">
            <span v-else class="i-carbon-sprout text-2xl text-gray-400" />
          </div>
          <div class="w-full truncate text-center text-sm font-medium">{{ draggedSeed.name }}</div>
          <span class="text-xs text-gray-500">库存 {{ draggedSeed.count }}</span>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.seed-drag-placeholder {
  opacity: 0.3;
  border-style: dashed;
  border-color: var(--theme-primary);
}

.seed-drop-before::before,
.seed-drop-after::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 3px;
  background: var(--theme-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-primary) 15%, transparent);
  pointer-events: none;
  z-index: 1;
}

.seed-drop-before::before {
  left: -6px;
}

.seed-drop-after::after {
  right: -6px;
}

.seed-drag-preview {
  z-index: 10000;
  pointer-events: none;
  border-color: var(--theme-primary);
  box-shadow: 0 16px 32px rgb(0 0 0 / 24%);
  transform: scale(1.04) rotate(2deg);
  will-change: left, top;
}

.seed-priority-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 7rem), 1fr));
  gap: 0.5rem;
}

.seed-priority-list {
  scrollbar-gutter: stable;
}
</style>
