<script lang="ts">
// All farm scenes reuse decoded textures. This matters when several friends are expanded.
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import LandCard from '@/components/LandCard.vue'

const props = withDefaults(defineProps<{
  lands: any[]
  weather?: any
}>(), {
  weather: undefined,
})

const emit = defineEmits<{
  (e: 'fertilize', land: any): void
  (e: 'remove', land: any): void
}>()

const farmSceneImageCache = new Map<string, HTMLImageElement>()

const viewport = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const visible = ref(false)
const selectedLandId = ref<number | null>(null)
const width = 1200
const height = 650
const landWidth = 210
const landHeight = 125
const stepX = 115
const stepY = 59
const mergedWidth = landWidth + stepX * 2
const mergedHeight = landHeight + stepY * 2
let visibilityObserver: IntersectionObserver | null = null

const displayLands = computed(() =>
  (Array.isArray(props.lands) ? props.lands : []).filter(land => !land?.occupiedByMaster),
)

// Crop countdowns change every second, but they do not change the canvas ground layer.
const canvasSignature = computed(() => displayLands.value.map(land => [
  land?.id,
  land?.level,
  land?.needWater,
  land?.status,
  land?.plantSize,
  Array.isArray(land?.occupiedLandIds) ? land.occupiedLandIds.join(',') : '',
].join(':')).join('|'))

function anchorId(land: any) {
  const ids = Array.isArray(land?.occupiedLandIds)
    ? land.occupiedLandIds.map(Number).filter((id: number) => id > 0)
    : []
  return ids.length > 1 ? Math.min(...ids) : Number(land?.id) || 0
}

function position(land: any) {
  const occupied = Array.isArray(land?.occupiedLandIds)
    ? land.occupiedLandIds.map(Number).filter((id: number) => id > 0)
    : []
  const ids = occupied.length > 1 ? occupied : [anchorId(land)]
  const points = ids.map((id: number) => {
    const column = (id - 1) % 4
    const row = Math.floor((id - 1) / 4)
    return { x: 700 + column * stepX - row * stepX, y: 86 + (column + row) * stepY }
  })
  return {
    x: points.reduce((sum: number, point: { x: number }) => sum + point.x, 0) / points.length,
    y: points.reduce((sum: number, point: { y: number }) => sum + point.y, 0) / points.length,
  }
}

function textureUrl(land: any) {
  const level = Math.min(5, Math.max(1, Number(land?.level) || 1))
  if (Number(land?.plantSize) > 1)
    return `/game-config/land_images/land_valid${level}_2x2.png`
  if (land?.status === 'locked')
    return '/game-config/land_images/land_locked.png'
  return `/game-config/land_images/${land?.needWater ? `land_dry${level}` : `land_valid${level}`}.png`
}

function loadImage(src: string) {
  const cached = farmSceneImageCache.get(src)
  if (cached)
    return Promise.resolve(cached)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      farmSceneImageCache.set(src, image)
      resolve(image)
    }
    image.onerror = reject
    image.src = src
  })
}

async function draw() {
  if (!visible.value)
    return
  await nextTick()
  const context = canvas.value?.getContext('2d')
  if (!context)
    return
  context.clearRect(0, 0, width, height)
  const field = await loadImage('/game-config/scene_images/farm-field-base.png').catch(() => null)
  if (field) {
    const scale = 1.16
    context.drawImage(field, (width - width * scale) / 2 + 10, (height - height * scale) / 2 + 8, width * scale, height * scale)
  }
  const lands = [...displayLands.value].sort((a, b) => position(a).y - position(b).y)
  const textures = await Promise.all(lands.map(land => loadImage(textureUrl(land)).catch(() => null)))
  lands.forEach((land, index) => {
    if (selectedLandId.value === Number(land?.id) || !textures[index])
      return
    const { x, y } = position(land)
    const large = Number(land?.plantSize) > 1
    const drawWidth = large ? mergedWidth : landWidth
    const drawHeight = large ? mergedHeight : landHeight
    if (Number(land?.level) === 5 && !large) {
      context.save()
      context.translate(x, y)
      context.rotate(Math.PI)
      context.drawImage(textures[index]!, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
      context.restore()
    }
    else {
      context.drawImage(textures[index]!, x - drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight)
    }
  })
}

function landStyle(land: any) {
  const { x, y } = position(land)
  const large = Number(land?.plantSize) > 1
  const drawWidth = large ? mergedWidth : landWidth
  const drawHeight = large ? mergedHeight : landHeight
  return {
    left: `${x / width * 100}%`,
    top: `${(y - drawHeight / 2) / height * 100}%`,
    width: `${drawWidth / width * 100}%`,
    height: `${drawHeight / height * 100}%`,
    zIndex: Math.round(y) + (large ? 2 : 1),
  }
}

function selectLand(land: any) {
  const id = Number(land?.id) || null
  selectedLandId.value = selectedLandId.value === id ? null : id
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (selectedLandId.value === null)
    return
  const target = event.target
  if (target instanceof Element && target.closest('.land-card, .land-bubble'))
    return
  selectedLandId.value = null
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    selectedLandId.value = null
}

watch(canvasSignature, draw, { flush: 'post' })
watch(selectedLandId, draw)
watch(visible, (isVisible) => {
  if (isVisible)
    draw()
})
onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
  if (!viewport.value)
    return
  visibilityObserver = new IntersectionObserver(([entry]) => {
    visible.value = Boolean(entry?.isIntersecting)
  }, { rootMargin: '160px 0px' })
  visibilityObserver.observe(viewport.value)
})
onUnmounted(() => {
  visibilityObserver?.disconnect()
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<template>
  <div ref="viewport" class="farm-scene-viewport" :class="{ 'farm-scene-selected': selectedLandId !== null }">
    <div class="farm-scene-stage">
      <canvas ref="canvas" class="farm-scene-canvas" :width="visible ? width : 1" :height="visible ? height : 1" aria-hidden="true" />
      <div v-if="weather?.rainstorm" class="farm-rainstorm-effect" aria-hidden="true">
        <img class="farm-rain-fog" src="/game-config/effect_images/rain-poem/rain-fog.png" alt="">
        <div class="farm-rain-streaks farm-rain-streaks-a" />
        <div class="farm-rain-streaks farm-rain-streaks-b" />
        <div class="farm-thunder-flash" />
      </div>
      <LandCard
        v-for="land in displayLands"
        :key="land.id"
        :land="land"
        isometric
        :style="landStyle(land)"
        :selected="selectedLandId === Number(land.id)"
        :selection-active="selectedLandId !== null"
        :show-actions="false"
        @select="selectLand"
        @fertilize="emit('fertilize', land)"
        @remove="emit('remove', land)"
      />
    </div>
  </div>
</template>

<style scoped>
.farm-scene-viewport {
  container-type: inline-size;
  overflow: hidden;
  width: 100%;
  max-width: 1200px;
  margin-inline: auto;
  border-radius: 1rem;
  background: #a8d85d;
  box-shadow: inset 0 0 0 1px rgb(53 101 37 / 18%);
}
.farm-scene-stage {
  position: relative;
  isolation: isolate;
  width: 100%;
  aspect-ratio: 1200 / 650;
}
.farm-scene-canvas {
  position: absolute;
  z-index: 0;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.farm-scene-selected :deep(.land-card:not(.land-card-selected) .land-bubble) {
  display: none !important;
}
.farm-rainstorm-effect {
  position: absolute;
  z-index: 1000;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: rgb(15 32 55 / 18%);
}
.farm-rain-fog,
.farm-rain-streaks,
.farm-thunder-flash {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.farm-rain-fog {
  object-fit: cover;
  opacity: 0.18;
  mix-blend-mode: screen;
  animation: farm-rain-fog-drift 8s ease-in-out infinite alternate;
}
.farm-rain-streaks {
  inset: -24%;
  width: 148%;
  height: 148%;
  background: url('/game-config/effect_images/rain-poem/rain-streaks.png') repeat;
  background-size: 36% auto;
  opacity: 0.52;
  filter: drop-shadow(1px 2px 1px rgb(155 211 255 / 42%));
  transform: rotate(4deg);
  animation: farm-rain-fall 0.78s linear infinite;
}
.farm-rain-streaks-b {
  background-size: 25% auto;
  opacity: 0.28;
  transform: rotate(7deg) scaleX(-1);
  animation-delay: -0.4s;
  animation-duration: 1.08s;
}
.farm-thunder-flash {
  background: rgb(208 235 255 / 72%);
  opacity: 0;
  animation: farm-thunder-flash 7.5s steps(1, end) infinite;
}
.farm-scene-stage :deep(.land-card) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}
.farm-scene-stage :deep(.land-card-image) {
  position: absolute;
  left: 50%;
  top: 35%;
  width: 42%;
  height: 68%;
  margin: 0;
  transform: translate(-50%, -50%);
}
.farm-scene-stage :deep(.land-card-image-seed-single) {
  top: 50%;
}
.farm-scene-stage :deep(.land-card-image-seed img) {
  width: 23%;
  max-width: none;
}
.farm-scene-stage :deep(.land-isometric-size-2 .land-card-image) {
  left: 50%;
  top: auto;
  bottom: 42%;
  width: 56%;
  height: 54%;
  align-items: flex-end;
  transform: translateX(-50%);
}
.farm-scene-stage :deep(.land-isometric-size-2 .land-card-image-seed) {
  top: 50%;
  bottom: auto;
  align-items: center;
  transform: translate(-50%, -50%);
}
.farm-scene-stage :deep(.land-isometric-size-2 .land-card-image-seed img) {
  width: 13%;
}
.farm-scene-stage :deep(.land-isometric-size-2 .land-card-image-paradise .land-crop-image) {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  transform: scale(1.35);
  transform-origin: 50% 82%;
  object-fit: contain;
}
.farm-scene-stage :deep(.land-card-name),
.farm-scene-stage :deep(.land-card-meta),
.farm-scene-stage :deep(.land-card-season),
.farm-scene-stage :deep(.land-card-flags),
.farm-scene-stage :deep(.land-mutant-effects),
.farm-scene-stage :deep(.land-ground-single),
.farm-scene-stage :deep(.land-ground-merged) {
  display: none;
}
.farm-scene-stage :deep(.land-card-selected .land-ground-single),
.farm-scene-stage :deep(.land-card-selected .land-ground-merged) {
  display: block;
  left: 50%;
  top: 50%;
  width: 100%;
  height: 100%;
  max-height: none;
  object-fit: fill;
  opacity: 1;
  transform: translate(-50%, -50%);
  filter: saturate(1.08) brightness(1.06) drop-shadow(0 10px 7px rgb(62 46 27 / 35%));
}
.farm-scene-stage :deep(.land-card-selected .land-ground-single.land-ground-rotated),
.farm-scene-stage :deep(.land-card-selected .land-ground-merged.land-ground-rotated) {
  transform: translate(-50%, -50%) rotate(180deg);
}
.farm-scene-stage :deep(.land-card-selected .land-ground-layer) {
  inset: 0;
}
.farm-scene-stage :deep(.land-isometric-size-2 .land-ground-merged) {
  width: 100%;
  max-height: none;
}
.farm-scene-stage :deep(.land-isometric-size-2 .land-ground-layer) {
  inset: 0;
}
@media (max-width: 639px) {
  .farm-scene-stage :deep(.land-card) {
    padding: 1px;
  }
  .farm-scene-stage :deep(.land-card-id) {
    font-size: 8px;
  }
}
@keyframes farm-rain-fall {
  from {
    background-position: 0 -45%;
  }
  to {
    background-position: -5% 0;
  }
}
@keyframes farm-rain-fog-drift {
  from {
    transform: translateX(-4%) scale(1.08);
  }
  to {
    transform: translateX(4%) scale(1.12);
  }
}
@keyframes farm-thunder-flash {
  0%,
  3%,
  5%,
  48%,
  51%,
  100% {
    opacity: 0;
  }
  2%,
  4% {
    opacity: 0.75;
  }
  49% {
    opacity: 0.42;
  }
}
@media (prefers-reduced-motion: reduce) {
  .farm-rain-fog,
  .farm-rain-streaks,
  .farm-thunder-flash {
    animation: none;
  }
  .farm-rain-streaks-b,
  .farm-thunder-flash {
    display: none;
  }
}
</style>
