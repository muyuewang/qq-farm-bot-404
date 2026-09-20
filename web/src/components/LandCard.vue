<script setup lang="ts">
import OfficialCrystalMutation from './OfficialCrystalMutation.vue'
import OfficialBichonMutation from './OfficialBichonMutation.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  land: any
  showActions?: boolean
  farmGrid?: boolean
  farmGridRowOffset?: number
  isometric?: boolean
  selected?: boolean
  selectionActive?: boolean
}>(), {
  showActions: true,
  farmGrid: false,
  farmGridRowOffset: 0,
  isometric: false,
  selected: false,
  selectionActive: false,
})

const emit = defineEmits<{
  (e: 'fertilize', land: any): void
  (e: 'remove', land: any): void
  (e: 'select', land: any): void
}>()

const land = computed(() => props.land)
const now = ref(Date.now())
const cardElement = ref<HTMLElement | null>(null)
const bubbleElement = ref<HTMLElement | null>(null)
const floatingBubbleStyle = ref<Record<string, string>>({})
const floatingBubbleBelow = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const floatingBubbleVisible = computed(() => props.selected)

async function updateFloatingBubblePosition() {
  if (!props.isometric || !floatingBubbleVisible.value)
    return
  await nextTick()
  const card = cardElement.value
  const bubble = bubbleElement.value
  if (!card || !bubble)
    return
  const cardRect = card.getBoundingClientRect()
  const width = bubble.offsetWidth
  const height = bubble.offsetHeight
  const gap = 10
  const margin = 8
  const spaceAbove = cardRect.top - margin - gap
  const spaceBelow = window.innerHeight - cardRect.bottom - margin - gap
  const below = spaceAbove < height && spaceBelow > spaceAbove
  const idealTop = below ? cardRect.bottom + gap : cardRect.top - height - gap
  const left = Math.min(window.innerWidth - width - margin, Math.max(margin, cardRect.left + cardRect.width / 2 - width / 2))
  const top = Math.min(window.innerHeight - height - margin, Math.max(margin, idealTop))
  floatingBubbleBelow.value = below
  floatingBubbleStyle.value = {
    '--bubble-arrow-left': `${Math.min(width - 18, Math.max(18, cardRect.left + cardRect.width / 2 - left))}px`,
    'left': `${left}px`,
    'top': `${top}px`,
  }
}

function handleBubbleAction(type: 'fertilize' | 'remove') {
  if (type === 'fertilize')
    emit('fertilize', land.value)
  else
    emit('remove', land.value)
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  window.addEventListener('resize', updateFloatingBubblePosition)
  window.addEventListener('scroll', updateFloatingBubblePosition, true)
})

onUnmounted(() => {
  if (timer)
    clearInterval(timer)
  window.removeEventListener('resize', updateFloatingBubblePosition)
  window.removeEventListener('scroll', updateFloatingBubblePosition, true)
})

const isFertilizable = computed(() =>
  Number(land.value?.matureInSec) > 0
  && land.value?.status !== 'locked'
  && land.value?.status !== 'empty',
)

const isRemovable = computed(() =>
  land.value?.status !== 'locked'
  && land.value?.status !== 'empty'
  && Boolean(
    land.value?.plantName
    || land.value?.seedImage
    || Number(land.value?.matureInSec) > 0
    || ['dead', 'growing', 'harvestable', 'stealable'].includes(String(land.value?.status || '')),
  ),
)

const canFertilize = computed(() => props.showActions && isFertilizable.value)
const canRemove = computed(() => props.showActions && isRemovable.value)

const landTextureName = computed(() => {
  const targetLand = land.value || {}
  const level = Math.min(5, Math.max(1, Number(targetLand.level) || 1))
  const isSnow = Boolean(
    targetLand.isSnow
    || targetLand.snow
    || targetLand.snowy
    || String(targetLand.weather || '').toLowerCase() === 'snow',
  )

  if (targetLand.status === 'locked')
    return isSnow ? 'land_locked_snow' : 'land_locked'

  if (targetLand.needWater) {
    if (level === 1 && isSnow)
      return 'land_dry1_snow'
    return `land_dry${level}`
  }

  if (level === 1 && isSnow)
    return 'land_valid1_snow'
  return `land_valid${level}`
})

const landTextureUrl = computed(() => {
  if (Number(land.value?.plantSize) > 1)
    return `/game-config/land_images/land_valid${Math.min(5, Math.max(1, Number(land.value?.level) || 1))}_2x2.png`
  return `/game-config/land_images/${landTextureName.value}.png`
})

const shouldRotateLandTexture = computed(() => {
  const level = Number(land.value?.level) || 1
  // 与 FarmPanel 的 Canvas 保持一致，避免选中 2x2 土地后再次翻转。
  return level === 5 && Number(land.value?.plantSize) <= 1
})

const mutantEffects = computed(() => {
  const effects = Array.isArray(land.value?.mutantEffects) ? land.value.mutantEffects : []
  return effects
    .map((effect: any) => {
      const icon = String(effect?.icon || '').trim()
      return {
        id: Number(effect?.id) || 0,
        name: String(effect?.name || effect?.effect_name || icon || '变异').trim(),
        icon,
        image: icon === 'lightning'
          ? '/activity/rain-poem/lightning-sense.png?v=2'
          : (icon ? `/game-config/seed_images_named/mutant/${icon}.png` : ''),
        tag: String(effect?.tag || '').trim(),
        description: String(effect?.description || effect?.desc || effect?.tips || '').trim(),
      }
    })
    .filter((effect: any) => effect.icon)
})

const hasGoldenMutation = computed(() => mutantEffects.value.some((effect: any) =>
  effect.id === 5 || effect.icon.toLowerCase() === 'golden',
))

function hasMutation(id: number, icon: string) {
  return mutantEffects.value.some((effect: any) =>
    effect.id === id || effect.icon.toLowerCase() === icon,
  )
}

const hasFrozenMutation = computed(() => hasMutation(1, 'frozen'))
const hasLoveMutation = computed(() => hasMutation(2, 'love'))
const hasDarkMutation = computed(() => hasMutation(3, 'dark'))
const hasMoistMutation = computed(() => hasMutation(4, 'moist'))
const hasLightningMutation = computed(() => hasMutation(12, 'lightning'))
const hasCrystalMutation = computed(() => hasMutation(14, 'crystal'))
const hasBichonMutation = computed(() => hasMutation(15, 'bichon'))
const hasParadiseMutation = computed(() => hasMutation(16, 'leyuan'))
const darkSmokeImageUrl = '/game-config/effect_images/mutant/dark-smoke.png'
const darkParticleImageUrl = '/game-config/effect_images/mutant/dark-particle.png'

// seedImage 是背包物品图标，不能用于地块；plantImage 包含客户端通用种子贴图
// model/v4/zhongzi，以及各作物从 Crop_*_2 开始的生长阶段贴图。
const cropImageUrl = computed(() => {
  return String(land.value?.plantImage || '').trim()
})

function getLandStatusClass(targetLand: any) {
  const status = targetLand.status
  const level = Number(targetLand.level) || 0

  if (status === 'locked')
    return 'land-level-locked bg-slate-50/90 dark:bg-slate-900/80 border-slate-300 dark:border-slate-700 border-dashed'

  const baseClass = `land-level-${Math.min(5, Math.max(1, level || 1))} bg-stone-50/90 dark:bg-stone-950/80 border-stone-300 dark:border-stone-700`

  if (status === 'dead')
    return 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 grayscale'

  if (status === 'harvestable')
    return `${baseClass} ring-2 ring-yellow-500 ring-offset-1 dark:ring-offset-gray-900`

  if (status === 'stealable')
    return `${baseClass} ring-2 ring-purple-500 ring-offset-1 dark:ring-offset-gray-900`

  if (mutantEffects.value.length > 0)
    return `${baseClass} ring-1 ring-pink-300 dark:ring-pink-700`

  return baseClass
}

function formatTime(sec: number) {
  if (sec <= 0)
    return ''

  const wholeSeconds = Math.floor(sec)
  const h = Math.floor(wholeSeconds / 3600)
  const m = Math.floor((wholeSeconds % 3600) / 60)
  const s = wholeSeconds % 60
  return `${h > 0 ? `${h}:` : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const statusLabel = computed(() => {
  const status = String(land.value?.status || '')
  const phaseName = String(land.value?.phaseName || '').trim()

  // “生长中”只是地块的操作状态；详情里应展示当前作物阶段。
  // 否则种子、发芽、小叶、大叶和开花期都会被错误地显示成同一个状态。
  if (status === 'growing' && phaseName)
    return phaseName

  const labels: Record<string, string> = {
    harvestable: '可收获',
    stealable: '可采摘',
    harvested: '已成熟',
    growing: '生长中',
    dead: '已枯萎',
    empty: '空闲',
    locked: '未解锁',
  }
  return labels[status] || phaseName || '未知状态'
})

const phaseProgress = computed(() => {
  const start = Number(land.value?.phaseStartTime) || 0
  const end = Number(land.value?.phaseEndTime) || 0
  if (end > start) {
    const duration = end - start
    const elapsed = Math.min(duration, Math.max(0, now.value / 1000 - start))
    return {
      percent: Math.round(elapsed / duration * 100),
      elapsed,
      duration,
    }
  }
  if (['harvestable', 'stealable', 'harvested', 'dead'].includes(String(land.value?.status || ''))) {
    return { percent: 100, elapsed: 0, duration: 0 }
  }
  return null
})

watch(floatingBubbleVisible, updateFloatingBubblePosition, { flush: 'post' })
watch(() => [phaseProgress.value?.percent, mutantEffects.value.length], updateFloatingBubblePosition, { flush: 'post' })

function getSafeImageUrl(url: string) {
  if (!url)
    return ''
  if (url.startsWith('http://'))
    return url.replace('http://', 'https://')
  return url
}

function getFarmGridStyle(targetLand: any) {
  if (!props.farmGrid)
    return undefined

  const occupiedIds = Array.isArray(targetLand?.occupiedLandIds)
    ? targetLand.occupiedLandIds.map(Number).filter((id: number) => id > 0)
    : []
  const anchorId = occupiedIds.length > 1
    ? Math.min(...occupiedIds)
    : Number(targetLand?.id)
  if (!anchorId)
    return undefined

  return {
    gridColumnStart: ((anchorId - 1) % 4) + 1,
    gridRowStart: Math.max(1, Math.floor((anchorId - 1) / 4) + 1 - props.farmGridRowOffset),
  }
}

function getFarmGridColumnClass(targetLand: any) {
  if (!props.farmGrid && !props.isometric)
    return ''
  const occupiedIds = Array.isArray(targetLand?.occupiedLandIds)
    ? targetLand.occupiedLandIds.map(Number).filter((id: number) => id > 0)
    : []
  const anchorId = occupiedIds.length > 1 ? Math.min(...occupiedIds) : Number(targetLand?.id)
  return anchorId ? `land-grid-column-${((anchorId - 1) % 4) + 1}` : ''
}

function getIsometricBubbleClass(targetLand: any) {
  if (!props.isometric)
    return ''
  const occupiedIds = Array.isArray(targetLand?.occupiedLandIds)
    ? targetLand.occupiedLandIds.map(Number).filter((id: number) => id > 0)
    : []
  const anchorId = occupiedIds.length > 1 ? Math.min(...occupiedIds) : Number(targetLand?.id)
  if (!anchorId)
    return ''
  const column = (anchorId - 1) % 4
  const row = Math.floor((anchorId - 1) / 4)
  return column + row <= 1 ? 'land-bubble-below' : ''
}
</script>

<template>
  <div
    ref="cardElement"
    class="land-card relative h-full min-h-0 flex flex-col cursor-pointer items-center rounded-lg px-2 pb-11 pt-2 transition"
    :class="[
      getLandStatusClass(land),
      getFarmGridColumnClass(land),
      getIsometricBubbleClass(land),
      {
        'col-span-2 row-span-2 justify-center px-4 pt-3': !isometric && Number(land.plantSize) > 1,
        'land-isometric': isometric,
        'land-isometric-size-2': isometric && Number(land.plantSize) > 1,
        'land-card-selected': selected,
      },
    ]"
    :style="getFarmGridStyle(land)"
    :role="isometric ? undefined : 'button'"
    :aria-label="isometric ? undefined : `土地 #${land.id} ${land.plantName || ''}`"
    :aria-pressed="isometric ? undefined : selected"
    :tabindex="isometric ? undefined : 0"
    @click="!isometric && $emit('select', land)"
    @keydown.enter.prevent="!isometric && $emit('select', land)"
    @keydown.space.prevent="!isometric && $emit('select', land)"
  >
    <button
      v-if="isometric"
      type="button"
      class="land-hit-area absolute"
      :aria-label="`土地 #${land.id} ${land.plantName || ''}`"
      :aria-pressed="selected"
      @click.stop="$emit('select', land)"
    />
    <div
      class="land-ground-layer pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <img
        :src="landTextureUrl"
        alt=""
        :class="[
          Number(land.plantSize) > 1 ? 'land-ground-merged' : 'land-ground-single',
          { 'land-ground-rotated': shouldRotateLandTexture },
        ]"
      >
    </div>

    <div class="land-card-id absolute left-1 top-1 text-[10px] text-gray-400 font-mono">
      #{{ land.id }}
    </div>

    <div
      v-if="land?.qixiDew?.applied"
      class="qixi-dew-effect pointer-events-none absolute"
      title="鹊羽灵露已生效"
      aria-label="鹊羽灵露已生效"
    >
      <img class="qixi-dew-feather qixi-dew-feather-1" src="/game-config/effect_images/qixi-dew/effect_yumao.png" alt="">
      <img class="qixi-dew-feather qixi-dew-feather-2" src="/game-config/effect_images/qixi-dew/effect_yumao.png" alt="">
      <img class="qixi-dew-feather qixi-dew-feather-3" src="/game-config/effect_images/qixi-dew/effect_yumao.png" alt="">
      <img class="qixi-dew-feather qixi-dew-feather-4" src="/game-config/effect_images/qixi-dew/effect_yumao.png" alt="">
      <img class="qixi-dew-feather qixi-dew-feather-5" src="/game-config/effect_images/qixi-dew/effect_yumao.png" alt="">
    </div>

    <div
      v-if="mutantEffects.length > 0"
      class="land-mutant-effects absolute left-1 top-5 flex flex-col gap-1"
    >
      <img
        v-for="effect in mutantEffects"
        :key="`${land.id}-${effect.id}-${effect.icon}`"
        :src="effect.image"
        :alt="effect.name"
        :title="effect.tag && effect.tag !== '无' ? `${effect.name} · ${effect.tag}` : effect.name"
        class="h-4 w-4 rounded-sm object-contain drop-shadow-sm"
        loading="lazy"
      >
    </div>

    <div
      class="land-card-image mb-0.5 mt-3 flex shrink-0 items-center justify-center"
      :class="[
        Number(land.plantSize) > 1 ? 'h-16 w-16' : 'h-9 w-9',
        {
          'land-card-image-seed': Number(land.imagePhase) === 1,
          'land-card-image-seed-single': Number(land.imagePhase) === 1 && Number(land.plantSize) <= 1,
          'land-card-image-golden': hasGoldenMutation && Boolean(cropImageUrl),
          'land-card-image-frozen': hasFrozenMutation && Boolean(cropImageUrl),
          'land-card-image-love': hasLoveMutation && Boolean(cropImageUrl),
          'land-card-image-dark': hasDarkMutation && Boolean(cropImageUrl),
          'land-card-image-moist': hasMoistMutation && Boolean(cropImageUrl),
          'land-card-image-lightning': hasLightningMutation && Boolean(cropImageUrl),
          'land-card-image-pet-mutation': (hasCrystalMutation || hasBichonMutation) && Boolean(cropImageUrl),
          'land-card-image-paradise': hasParadiseMutation && Boolean(cropImageUrl),
        },
      ]"
    >
      <div v-if="hasGoldenMutation && cropImageUrl" class="golden-mutation-aura" aria-hidden="true" />
      <div v-if="hasGoldenMutation && cropImageUrl" class="golden-mutation-sparkles" aria-hidden="true">
        <i v-for="index in 6" :key="index" />
      </div>
      <div v-if="hasFrozenMutation && cropImageUrl" class="frozen-mutation-layer" aria-hidden="true">
        <i v-for="index in 6" :key="index">✦</i>
      </div>
      <div v-if="hasLoveMutation && cropImageUrl" class="love-mutation-layer" aria-hidden="true">
        <i v-for="index in 5" :key="index">♥</i>
      </div>
      <div v-if="hasDarkMutation && cropImageUrl" class="dark-mutation-layer" aria-hidden="true">
        <img v-for="index in 4" :key="`smoke-${index}`" :src="darkSmokeImageUrl" alt="" class="dark-mutation-smoke">
        <img v-for="index in 5" :key="`particle-${index}`" :src="darkParticleImageUrl" alt="" class="dark-mutation-particle">
      </div>
      <div v-if="hasMoistMutation && cropImageUrl" class="moist-mutation-layer" aria-hidden="true">
        <i v-for="index in 4" :key="index" />
      </div>
      <div v-if="hasLightningMutation && cropImageUrl" class="lightning-mutation-layer" aria-hidden="true">
        <img
          v-for="index in 4"
          :key="`lightning-frame-${index}`"
          :src="`/game-config/effect_images/rain-poem/lightning-0${index - 1}.png`"
          :class="`lightning-mutation-frame lightning-mutation-frame-${index}`"
          alt=""
        >
      </div>
      <OfficialCrystalMutation
        v-if="hasCrystalMutation && cropImageUrl && !['dead', 'empty', 'locked'].includes(land.status)"
      />
      <OfficialBichonMutation
        v-if="hasBichonMutation && cropImageUrl && !['dead', 'empty', 'locked'].includes(land.status)"
      />
      <img
        v-if="cropImageUrl"
        :src="getSafeImageUrl(cropImageUrl)"
        class="land-crop-image max-h-full max-w-full object-contain"
        loading="lazy"
        referrerpolicy="no-referrer"
      >
      <div v-else-if="Number(land.phase) !== 1" class="i-carbon-sprout text-xl text-gray-300" />
    </div>

    <div
      class="land-card-name w-full shrink-0 truncate px-1 text-center text-gray-900 font-bold leading-5 dark:text-gray-100"
      :class="Number(land.plantSize) > 1 ? 'text-sm' : 'text-xs'"
      :title="land.plantName"
    >
      {{ land.plantName || '-' }}
    </div>

    <div class="land-card-meta mb-0.5 mt-0.5 w-full shrink-0 text-center text-[10px] text-gray-500">
      <span v-if="land.matureInSec > 0" class="text-orange-800 font-medium dark:text-orange-300">
        预计 {{ formatTime(land.matureInSec) }} 后成熟
      </span>
      <span v-else>
        {{ land.phaseName || (land.status === 'locked' ? '未解锁' : '未开垦') }}
      </span>
    </div>

    <div class="mb-0.5 mt-0.5 flex shrink-0 items-center justify-center gap-1.5">
      <span class="land-card-season whitespace-nowrap text-[10px] text-gray-800 font-medium dark:text-gray-200">
        季数 {{ land.totalSeason > 0 ? (`${land.currentSeason}/${land.totalSeason}`) : '-/-' }}
      </span>
    </div>

    <div class="land-card-flags min-h-4 flex shrink-0 origin-bottom scale-90 gap-0.5 text-[10px]">
      <span v-if="land.needWater" class="rounded bg-blue-100 px-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" title="需要浇水"><span v-if="isometric" class="i-carbon-rain-drop" /><template v-else>水</template></span>
      <span v-if="land.needWeed" class="rounded bg-green-100 px-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400" title="需要除草"><span v-if="isometric" class="i-carbon-sprout" /><template v-else>草</template></span>
      <span v-if="land.needBug" class="rounded bg-red-100 px-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400" title="需要除虫"><span v-if="isometric" class="i-carbon-warning-alt" /><template v-else>虫</template></span>
      <span v-if="land.status === 'harvestable'" class="rounded bg-orange-100 px-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">可收</span>
      <span v-else-if="land.status === 'stealable'" class="rounded bg-purple-100 px-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">可偷</span>
    </div>

    <div
      v-if="canFertilize || canRemove"
      class="land-actions absolute bottom-2 left-2 right-2 grid grid-cols-2 h-7 gap-1"
    >
      <button
        v-if="canFertilize"
        type="button"
        class="land-action-button text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
        title="催熟"
        @click.stop="$emit('fertilize', land)"
      >
        <span class="i-carbon-growth text-sm" />
        <span>催熟</span>
      </button>
      <div v-else />

      <button
        v-if="canRemove"
        type="button"
        class="land-action-button text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30"
        title="铲除作物"
        @click.stop="$emit('remove', land)"
      >
        <span class="i-carbon-trash-can text-sm" />
        <span>铲除</span>
      </button>
    </div>

    <Teleport v-if="farmGrid || isometric" to="body" :disabled="!isometric">
      <div
        v-show="!isometric || floatingBubbleVisible"
        ref="bubbleElement"
        class="land-bubble"
        :class="{
          'land-bubble-floating': isometric,
          'land-bubble-floating-below': isometric && floatingBubbleBelow,
        }"
        :style="isometric ? floatingBubbleStyle : undefined"
        role="dialog"
        :aria-label="`土地 #${land.id} 详情`"
        @click.stop
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[10px] text-gray-400">
              土地 #{{ land.id }}
            </div>
            <div class="truncate text-sm text-gray-900 font-bold dark:text-gray-100">
              {{ land.plantName || '未种植' }}
            </div>
          </div>
          <span class="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700 font-medium dark:bg-green-900/30 dark:text-green-300">{{ statusLabel }}</span>
        </div>

        <div class="grid grid-cols-2 mt-2 gap-2 text-xs">
          <div class="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/60">
            <div class="text-[10px] text-gray-400">
              成熟倒计时
            </div>
            <div class="mt-0.5 font-semibold tabular-nums">
              {{ land.matureInSec > 0 ? formatTime(land.matureInSec) : '—' }}
            </div>
          </div>
          <div class="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/60">
            <div class="text-[10px] text-gray-400">
              生长季数
            </div>
            <div class="mt-0.5 font-semibold">
              {{ land.totalSeason > 0 ? `${land.currentSeason}/${land.totalSeason}` : '—' }}
            </div>
          </div>
        </div>

        <div v-if="phaseProgress" class="mt-2 rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/30">
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="truncate text-emerald-700 font-medium dark:text-emerald-300">
              {{ land.phaseName || '当前阶段' }}
            </span>
            <span class="shrink-0 text-emerald-600 font-semibold tabular-nums dark:text-emerald-300">
              {{ phaseProgress.percent }}%
            </span>
          </div>
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900/60">
            <div
              class="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
              :style="{ width: `${phaseProgress.percent}%` }"
            />
          </div>
          <div v-if="phaseProgress.duration > 0" class="mt-1 flex justify-between text-[10px] text-gray-400 tabular-nums">
            <span>已进行 {{ formatTime(phaseProgress.elapsed) }}</span>
            <span>本阶段 {{ formatTime(phaseProgress.duration) }}</span>
          </div>
        </div>

        <div v-if="mutantEffects.length > 0" class="mt-2 rounded-lg bg-pink-50 p-2 dark:bg-pink-950/30">
          <div class="mb-1 text-[10px] text-pink-500 font-medium dark:text-pink-300">
            变异效果
          </div>
          <div class="flex flex-wrap gap-1.5">
            <div
              v-for="effect in mutantEffects"
              :key="`bubble-${land.id}-${effect.id}-${effect.icon}`"
              class="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] text-pink-700 shadow-sm dark:bg-gray-900 dark:text-pink-200"
            >
              <img :src="effect.image" :alt="effect.name" class="h-4 w-4 object-contain">
              <span class="font-medium">{{ effect.name }}</span>
              <span v-if="effect.tag && effect.tag !== '无'" class="text-[10px] text-pink-400">· {{ effect.tag }}</span>
            </div>
          </div>
          <div class="mt-2 rounded-md bg-white/85 px-2 py-1.5 text-[11px] text-pink-700 shadow-sm space-y-1 dark:bg-gray-900/85 dark:text-pink-200">
            <div v-for="effect in mutantEffects" :key="`description-${effect.id}-${effect.icon}`">
              {{ effect.description || effect.name }}
            </div>
          </div>
        </div>

        <div v-if="land.needWater || land.needWeed || land.needBug" class="mt-2 flex flex-wrap gap-1 text-[10px]">
          <span v-if="land.needWater" class="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">需要浇水</span>
          <span v-if="land.needWeed" class="rounded-full bg-green-100 px-2 py-0.5 text-green-700">需要除草</span>
          <span v-if="land.needBug" class="rounded-full bg-red-100 px-2 py-0.5 text-red-700">需要除虫</span>
        </div>

        <div v-if="isFertilizable || isRemovable" class="grid grid-cols-2 mt-2 gap-2">
          <button type="button" class="bubble-action border-emerald-600 text-emerald-700 dark:text-emerald-300" :disabled="!isFertilizable" @click="handleBubbleAction('fertilize')">
            <span class="i-carbon-growth" />催熟
          </button>
          <button type="button" class="bubble-action border-red-500 text-red-600 dark:text-red-300" :disabled="!isRemovable" @click="handleBubbleAction('remove')">
            <span class="i-carbon-trash-can" />铲除
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.qixi-dew-effect {
  z-index: 6;
  left: 50%;
  top: 46%;
  width: 70%;
  height: 72%;
  transform: translate(-50%, -50%);
  overflow: hidden;
}

.qixi-dew-effect img {
  position: absolute;
  display: block;
  object-fit: contain;
  user-select: none;
}

.qixi-dew-feather {
  top: -20%;
  width: 22%;
  opacity: 0;
  transform-origin: center;
  filter: brightness(1.55) saturate(0.7) drop-shadow(0 0 3px rgb(255 244 249 / 0.82));
  animation: qixi-dew-feather-fall 4.8s linear infinite backwards;
}

.qixi-dew-feather-1 {
  left: 4%;
  animation-delay: -0.4s;
}

.qixi-dew-feather-2 {
  left: 26%;
  width: 17%;
  animation-delay: -3.2s;
  animation-duration: 5.4s;
}

.qixi-dew-feather-3 {
  left: 48%;
  width: 24%;
  animation-delay: -1.8s;
  animation-duration: 5.8s;
}

.qixi-dew-feather-4 {
  left: 68%;
  width: 15%;
  animation-delay: -4.3s;
  animation-duration: 4.5s;
}

.qixi-dew-feather-5 {
  left: 81%;
  width: 12%;
  animation-delay: -2.7s;
  animation-duration: 6.2s;
}

.land-isometric-size-2 .qixi-dew-effect {
  top: 45%;
  width: 52%;
  height: 68%;
}

@keyframes qixi-dew-feather-fall {
  0% {
    opacity: 0;
    transform: translate3d(-8%, -8%, 0) rotate(-18deg) scale(0.72);
  }
  16% {
    opacity: 0.3;
    transform: translate3d(10%, 18%, 0) rotate(4deg) scale(0.82);
  }
  42% {
    opacity: 0.58;
    transform: translate3d(-12%, 58%, 0) rotate(-12deg) scale(0.92);
  }
  72% {
    opacity: 0.4;
    transform: translate3d(14%, 108%, 0) rotate(11deg) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate3d(-5%, 160%, 0) rotate(-8deg) scale(1.05);
  }
}

@media (prefers-reduced-motion: reduce) {
  .qixi-dew-effect img {
    animation: none !important;
  }
  .qixi-dew-feather {
    display: none;
  }
  .qixi-dew-feather-3 {
    display: block;
    top: 38%;
    opacity: 0.38;
    transform: rotate(-8deg);
  }
}

.land-card-image-golden {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: 42%;
}

.land-card-image-golden .land-crop-image {
  position: relative;
  z-index: 2;
  animation: golden-crop-glow 2.4s ease-in-out infinite;
}

.golden-mutation-aura {
  position: absolute;
  z-index: 0;
  inset: -6%;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(
    circle,
    rgb(255 248 184 / 0.78) 0 24%,
    rgb(250 204 21 / 0.38) 43%,
    rgb(245 158 11 / 0.12) 62%,
    transparent 74%
  );
  filter: blur(2px);
  animation: golden-aura-pulse 2.4s ease-in-out infinite;
}

.golden-mutation-sparkles {
  position: absolute;
  z-index: 3;
  inset: 0;
  overflow: hidden;
  border-radius: 44%;
  pointer-events: none;
  animation: golden-sparkle-orbit 9s linear infinite;
}

.golden-mutation-sparkles i {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #fff8a6;
  box-shadow: 0 0 4px 1px rgb(250 204 21 / 0.9);
  animation: golden-sparkle-blink 1.8s ease-in-out infinite;
}

.golden-mutation-sparkles i:nth-child(1) {
  left: 12%;
  top: 24%;
}
.golden-mutation-sparkles i:nth-child(2) {
  right: 10%;
  top: 18%;
  animation-delay: -0.6s;
}
.golden-mutation-sparkles i:nth-child(3) {
  right: 2%;
  top: 57%;
  animation-delay: -1.2s;
}
.golden-mutation-sparkles i:nth-child(4) {
  bottom: 8%;
  left: 62%;
  animation-delay: -0.3s;
}
.golden-mutation-sparkles i:nth-child(5) {
  bottom: 14%;
  left: 9%;
  animation-delay: -0.9s;
}
.golden-mutation-sparkles i:nth-child(6) {
  left: 42%;
  top: 2%;
  animation-delay: -1.5s;
}

.land-card-image-pet-mutation,
.land-card-image-frozen,
.land-card-image-love,
.land-card-image-dark,
.land-card-image-moist,
.land-card-image-lightning {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: 42%;
}

.land-card-image-frozen .land-crop-image {
  position: relative;
  z-index: 2;
  animation: frozen-crop-glow 2.8s ease-in-out infinite;
}

.frozen-mutation-layer,
.love-mutation-layer,
.dark-mutation-layer,
.moist-mutation-layer,
.lightning-mutation-layer {
  position: absolute;
  z-index: 3;
  inset: 0;
  overflow: hidden;
  border-radius: 42%;
  pointer-events: none;
}

.frozen-mutation-layer {
  background: transparent;
}

.frozen-mutation-layer i {
  position: absolute;
  color: #e0f2fe;
  font-size: 7px;
  text-shadow: 0 0 4px #38bdf8;
  animation: frozen-crystal-twinkle 1.9s ease-in-out infinite;
}

.frozen-mutation-layer i:nth-child(1) {
  left: 4%;
  top: 22%;
}
.frozen-mutation-layer i:nth-child(2) {
  right: 5%;
  top: 12%;
  animation-delay: -0.5s;
}
.frozen-mutation-layer i:nth-child(3) {
  right: -1%;
  top: 56%;
  animation-delay: -1s;
}
.frozen-mutation-layer i:nth-child(4) {
  bottom: 3%;
  left: 66%;
  animation-delay: -1.5s;
}
.frozen-mutation-layer i:nth-child(5) {
  bottom: 8%;
  left: 5%;
  animation-delay: -0.8s;
}
.frozen-mutation-layer i:nth-child(6) {
  left: 45%;
  top: -5%;
  animation-delay: -1.3s;
}

.land-card-image-love .land-crop-image,
.land-card-image-dark .land-crop-image {
  position: relative;
  z-index: 2;
}

.land-card-image-love .land-crop-image {
  filter: saturate(1.22) brightness(1.05) drop-shadow(0 0 5px rgb(244 63 94 / 0.82));
}

.love-mutation-layer i {
  position: absolute;
  bottom: -2px;
  color: #ff2f6d;
  font-size: 10px;
  font-style: normal;
  line-height: 1;
  text-shadow:
    0 0 2px #fff,
    0 0 5px rgb(244 63 94 / 0.95);
  animation: love-heart-rise 2.2s ease-in infinite;
}

.love-mutation-layer i:nth-child(1) {
  left: 8%;
}
.love-mutation-layer i:nth-child(2) {
  left: 28%;
  animation-delay: -0.7s;
}
.love-mutation-layer i:nth-child(3) {
  left: 48%;
  animation-delay: -1.4s;
}
.love-mutation-layer i:nth-child(4) {
  left: 68%;
  animation-delay: -2.1s;
}
.love-mutation-layer i:nth-child(5) {
  left: 86%;
  animation-delay: -2.5s;
}

.land-card-image-dark .land-crop-image {
  animation: dark-crop-pulse 3.2s ease-in-out infinite;
}

.dark-mutation-smoke,
.dark-mutation-particle {
  position: absolute;
  object-fit: contain;
  pointer-events: none;
}

.dark-mutation-smoke {
  width: 58%;
  opacity: 0;
  filter: sepia(1) saturate(2.2) hue-rotate(225deg) brightness(0.48);
  mix-blend-mode: multiply;
  animation: dark-smoke-drift 3.6s ease-in-out infinite;
}

.dark-mutation-smoke:nth-child(1) {
  bottom: 4%;
  left: -4%;
}
.dark-mutation-smoke:nth-child(2) {
  right: -7%;
  bottom: 8%;
  animation-delay: -0.9s;
}
.dark-mutation-smoke:nth-child(3) {
  top: 12%;
  left: 5%;
  animation-delay: -1.8s;
}
.dark-mutation-smoke:nth-child(4) {
  top: 4%;
  right: 2%;
  animation-delay: -2.7s;
}

.dark-mutation-particle {
  width: 13%;
  opacity: 0;
  filter: sepia(1) saturate(3) hue-rotate(220deg) brightness(0.7);
  animation: dark-particle-flicker 2.4s ease-in-out infinite;
}

.dark-mutation-particle:nth-child(5) {
  left: 10%;
  top: 24%;
}
.dark-mutation-particle:nth-child(6) {
  right: 8%;
  top: 18%;
  animation-delay: -0.5s;
}
.dark-mutation-particle:nth-child(7) {
  bottom: 10%;
  left: 28%;
  animation-delay: -1s;
}
.dark-mutation-particle:nth-child(8) {
  right: 22%;
  bottom: 8%;
  animation-delay: -1.5s;
}
.dark-mutation-particle:nth-child(9) {
  left: 46%;
  top: 4%;
  animation-delay: -2s;
}

.moist-mutation-layer i {
  position: absolute;
  top: -5px;
  width: 3px;
  height: 5px;
  border-radius: 50% 50% 55% 55%;
  background: rgb(56 189 248 / 0.9);
  box-shadow: 0 0 1px rgb(255 255 255 / 0.85);
  animation: moist-drop-fall 1.6s linear infinite;
}

.moist-mutation-layer i:nth-child(1) {
  left: 15%;
}
.moist-mutation-layer i:nth-child(2) {
  left: 39%;
  animation-delay: -0.8s;
}
.moist-mutation-layer i:nth-child(3) {
  left: 63%;
  animation-delay: -0.4s;
}
.moist-mutation-layer i:nth-child(4) {
  left: 84%;
  animation-delay: -1.2s;
}

.land-card-image-lightning .land-crop-image {
  position: relative;
  z-index: 2;
}

.lightning-mutation-layer {
  z-index: 4;
  overflow: visible;
}

.lightning-mutation-frame {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 145%;
  height: 145%;
  object-fit: contain;
  opacity: 0;
  transform: translate(-50%, -50%);
  animation: official-lightning-frame 1s steps(1, end) infinite;
}

.lightning-mutation-frame-2 {
  animation-delay: -0.75s;
}
.lightning-mutation-frame-3 {
  animation-delay: -0.5s;
}
.lightning-mutation-frame-4 {
  animation-delay: -0.25s;
}

@keyframes golden-crop-glow {
  0%,
  100% {
    filter: sepia(1) saturate(3.6) hue-rotate(345deg) brightness(1.08) contrast(1.08)
      drop-shadow(0 0 3px rgb(250 204 21 / 0.72));
  }
  50% {
    filter: sepia(1) saturate(4.8) hue-rotate(350deg) brightness(1.2) contrast(1.12)
      drop-shadow(0 0 8px rgb(245 158 11 / 0.98));
  }
}

@keyframes golden-aura-pulse {
  0%,
  100% {
    opacity: 0.62;
    transform: scale(0.88);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@keyframes golden-sparkle-orbit {
  to {
    transform: rotate(360deg);
  }
}

@keyframes golden-sparkle-blink {
  0%,
  100% {
    opacity: 0.2;
    transform: scale(0.55);
  }
  50% {
    opacity: 1;
    transform: scale(1.25);
  }
}

@keyframes frozen-crop-glow {
  0%,
  100% {
    filter: saturate(0.72) hue-rotate(72deg) brightness(1.13) contrast(1.04)
      drop-shadow(0 0 3px rgb(125 211 252 / 0.78));
  }
  50% {
    filter: saturate(0.62) hue-rotate(82deg) brightness(1.24) contrast(1.08) drop-shadow(0 0 6px rgb(56 189 248 / 0.94));
  }
}

@keyframes frozen-crystal-twinkle {
  0%,
  100% {
    opacity: 0.24;
    transform: scale(0.65) rotate(0);
  }
  50% {
    opacity: 1;
    transform: scale(1.2) rotate(45deg);
  }
}

@keyframes love-heart-rise {
  0% {
    opacity: 0;
    transform: translateY(2px) scale(0.7) rotate(-8deg);
  }
  28% {
    opacity: 0.95;
  }
  100% {
    opacity: 0;
    transform: translateY(-21px) scale(1.15) rotate(10deg);
  }
}

@keyframes dark-crop-pulse {
  0%,
  100% {
    filter: saturate(0.78) brightness(0.82) contrast(1.06) hue-rotate(8deg) drop-shadow(0 0 2px rgb(76 29 149 / 0.42));
  }
  50% {
    filter: saturate(0.84) brightness(0.88) contrast(1.08) hue-rotate(13deg) drop-shadow(0 0 3px rgb(109 40 217 / 0.52));
  }
}

@keyframes dark-smoke-drift {
  0%,
  100% {
    opacity: 0;
    transform: translateY(3px) scale(0.72) rotate(-8deg);
  }
  35% {
    opacity: 0.24;
  }
  65% {
    opacity: 0.14;
    transform: translateY(-5px) scale(1.04) rotate(6deg);
  }
}

@keyframes dark-particle-flicker {
  0%,
  100% {
    opacity: 0;
    transform: translateY(3px) scale(0.55);
  }
  45% {
    opacity: 0.55;
    transform: translateY(-2px) scale(0.9);
  }
  70% {
    opacity: 0.18;
    transform: translateY(-6px) scale(0.7);
  }
}

@keyframes moist-drop-fall {
  0% {
    opacity: 0;
    transform: translateY(0);
  }
  15% {
    opacity: 0.9;
  }
  80% {
    opacity: 0.9;
  }
  100% {
    opacity: 0;
    transform: translateY(36px);
  }
}

@keyframes official-lightning-frame {
  0%,
  24.99% {
    opacity: 1;
  }
  25%,
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .land-card-image-golden .land-crop-image,
  .golden-mutation-aura,
  .golden-mutation-sparkles,
  .golden-mutation-sparkles i,
  .land-card-image-frozen .land-crop-image,
  .land-card-image-dark .land-crop-image,
  .frozen-mutation-layer i,
  .love-mutation-layer i,
  .dark-mutation-smoke,
  .dark-mutation-particle,
  .moist-mutation-layer i,
  .lightning-mutation-frame {
    animation: none;
  }

  .lightning-mutation-frame-1 {
    opacity: 1;
  }

  .land-card-image-golden .land-crop-image {
    filter: sepia(1) saturate(4.2) hue-rotate(348deg) brightness(1.14) contrast(1.1)
      drop-shadow(0 0 5px rgb(250 204 21 / 0.8));
  }
}

.land-ground-layer {
  z-index: 0;
}

.land-card-selected {
  z-index: 100 !important;
  box-shadow:
    0 0 0 3px rgb(59 130 246 / 0.88),
    0 8px 20px rgb(15 23 42 / 0.2);
}

.land-isometric.land-card-selected {
  box-shadow: none;
  transform: translate(-50%, -8px) scale(1.02);
}

.land-isometric.land-card-selected .land-card-image {
  z-index: 1;
  filter: saturate(1.08) brightness(1.06) drop-shadow(0 7px 5px rgb(56 42 25 / 0.28));
}

.land-isometric {
  position: absolute;
  pointer-events: none;
  padding: 2px;
  transform: translateX(-50%);
  transform-origin: 50% 50%;
}

.land-hit-area {
  z-index: 2;
  left: 2%;
  top: 8%;
  width: 96%;
  height: 80%;
  cursor: pointer;
  pointer-events: auto;
  border: 0;
  background: transparent;
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
}

.land-bubble {
  position: absolute;
  z-index: 30 !important;
  left: 50%;
  top: calc(100% + 6px);
  width: min(240px, calc(100vw - 40px));
  display: none;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 12px;
  background: rgb(255 255 255 / 0.98);
  color: #334155;
  text-align: left;
  box-shadow: 0 14px 32px rgb(15 23 42 / 0.24);
  transform: translateX(-50%);
}

.land-bubble::before {
  position: absolute;
  left: 50%;
  top: -7px;
  width: 12px;
  height: 12px;
  content: '';
  border-left: 1px solid rgb(226 232 240);
  border-top: 1px solid rgb(226 232 240);
  background: inherit;
  transform: translateX(-50%) rotate(45deg);
}

.land-bubble-floating {
  position: fixed;
  z-index: 1000 !important;
  right: auto;
  display: block;
  pointer-events: auto;
  transform: none;
}

.land-bubble-floating::before {
  left: var(--bubble-arrow-left, 50%);
  top: auto;
  bottom: -7px;
  border: 0;
  border-right: 1px solid rgb(226 232 240);
  border-bottom: 1px solid rgb(226 232 240);
}

.land-bubble-floating.land-bubble-floating-below::before {
  top: -7px;
  bottom: auto;
  border: 0;
  border-left: 1px solid rgb(226 232 240);
  border-top: 1px solid rgb(226 232 240);
}

.land-card-selected .land-bubble {
  display: block;
}

.land-grid-column-1 .land-bubble {
  left: 0;
  transform: none;
}

.land-grid-column-1 .land-bubble::before {
  left: 25%;
}

.land-grid-column-4 .land-bubble {
  right: 0;
  left: auto;
  transform: none;
}

.land-grid-column-4 .land-bubble::before {
  right: 25%;
  left: auto;
}

.land-isometric .land-card-id {
  display: none;
}

.land-isometric .land-bubble {
  top: 4px;
  transform: translate(-50%, calc(-100% - 8px));
}

.land-isometric .land-bubble::before {
  top: auto;
  bottom: -7px;
  border: 0;
  border-right: 1px solid rgb(226 232 240);
  border-bottom: 1px solid rgb(226 232 240);
}

.land-isometric.land-grid-column-1 .land-bubble,
.land-isometric.land-grid-column-4 .land-bubble {
  transform: translateY(calc(-100% - 8px));
}

.land-isometric.land-bubble-below .land-bubble {
  top: calc(100% - 8px);
  transform: translateX(-50%);
}

.land-isometric.land-bubble-below .land-bubble::before {
  top: -7px;
  bottom: auto;
  border: 0;
  border-left: 1px solid rgb(226 232 240);
  border-top: 1px solid rgb(226 232 240);
}

.land-isometric.land-bubble-below.land-grid-column-1 .land-bubble,
.land-isometric.land-bubble-below.land-grid-column-4 .land-bubble {
  transform: none;
}

.bubble-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 32px;
  border-width: 1px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}

.bubble-action:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

:global(.dark) .land-bubble {
  border-color: #475569;
  background: rgb(31 41 55 / 0.98);
  color: #e5e7eb;
}

.land-ground-single {
  position: absolute;
  left: 50%;
  top: 47%;
  width: 94%;
  height: auto;
  max-height: 68%;
  object-fit: contain;
  transform: translate(-50%, -50%);
  opacity: 0.82;
  filter: saturate(1.05) drop-shadow(0 3px 4px rgba(71, 53, 35, 0.16));
}

.land-card.col-span-2 .land-ground-layer,
.land-card.land-isometric-size-2 .land-ground-layer {
  left: 7%;
  right: 7%;
  top: 12%;
  bottom: 15%;
}

.land-ground-merged {
  position: absolute;
  left: 50%;
  top: 48%;
  width: 94%;
  height: auto;
  max-height: 74%;
  object-fit: contain;
  transform: translate(-50%, -50%);
  opacity: 0.82;
  filter: saturate(1.05) drop-shadow(0 3px 4px rgba(71, 53, 35, 0.14));
}

.land-ground-single.land-ground-rotated,
.land-ground-merged.land-ground-rotated {
  transform: translate(-50%, -50%) rotate(180deg);
}

.land-card > :not(.land-ground-layer) {
  z-index: 1;
}

.land-card-name,
.land-card-meta,
.land-card-season {
  text-shadow:
    0 1px 2px rgba(255, 255, 255, 0.95),
    0 0 5px rgba(255, 255, 255, 0.88);
}

:global(.dark) .land-card-name,
:global(.dark) .land-card-meta,
:global(.dark) .land-card-season {
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.95),
    0 0 5px rgba(0, 0, 0, 0.8);
}

.land-action-button {
  height: 28px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.78);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  box-shadow: inset 0 0 0 1px currentColor;
  transition:
    background-color 0.15s ease,
    transform 0.15s ease;
}

.land-action-button:hover {
  transform: translateY(-1px);
}

.land-level-black .land-card-id,
.land-level-black .land-card-meta,
.land-level-black .land-card-season {
  color: #475569;
}

:global(.dark) .land-level-black .land-card-id,
:global(.dark) .land-level-black .land-card-meta,
:global(.dark) .land-level-black .land-card-season {
  color: #cbd5e1;
}

.land-level-black .land-card-name {
  color: #111827;
  text-shadow: none;
}

:global(.dark) .land-level-black .land-card-name {
  color: #f8fafc;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.65);
}

.land-level-black .land-action-button {
  background: rgba(255, 255, 255, 0.78);
}

:global(.dark) .land-level-black .land-action-button {
  background: rgba(255, 255, 255, 0.9);
}
</style>
