<script setup lang="ts">
defineProps<{ running: boolean }>()
// Positions, anchors, scale and layer order from the official 610 × 570 Cocos scene.
// Three pines share an orbit with different phases; the lower 150px sits behind the charm card.
const scenery = [
  {
    file: 'img_s3Treasure_a6',
    x: 305,
    y: 922.267,
    scale: 0.75,
    imageX: -121,
    imageY: -1134,
    width: 242,
    height: 126,
    from: 29.752,
    to: -29.902,
    initial: -4.673,
    duration: 40,
    delay: -23.083,
  },
  {
    file: 'img_s3Treasure_a6',
    x: 305,
    y: 924.846,
    scale: 1,
    imageX: -121,
    imageY: -667.8,
    width: 242,
    height: 126,
    from: 40.658,
    to: -41.054,
    initial: 40.658,
    duration: 80,
    delay: 0,
  },
  {
    file: 'img_s3Treasure_a6',
    x: 305,
    y: 923.932,
    scale: 0.53,
    imageX: -121,
    imageY: -1474.2,
    width: 242,
    height: 126,
    from: 29.625,
    to: -30.854,
    initial: 29.625,
    duration: 40,
    delay: 0,
  },
  {
    file: 'img_s3Treasure_a1',
    x: 305,
    y: 1452.196,
    scale: 1,
    imageX: -146.5,
    imageY: -1250.6,
    width: 293,
    height: 169,
    from: 23.493,
    to: -24.138,
    initial: 23.493,
    duration: 20,
    delay: 0,
  },
  {
    file: 'img_s3Treasure_a0',
    x: 305,
    y: 1127.419,
    scale: 1,
    imageX: -55.688,
    imageY: -944.45,
    width: 109,
    height: 157,
    from: 24.411,
    to: -25.77,
    initial: -7.788,
    duration: 10,
    delay: -6.417,
  },
  {
    file: 'img_s3Treasure_a0',
    x: 305,
    y: 1328.25,
    scale: 0.7,
    imageX: -54.499,
    imageY: -1569.665,
    width: 109,
    height: 157,
    from: 24.411,
    to: -25.77,
    initial: 9.44,
    duration: 10,
    delay: -2.983,
  },
  {
    file: 'img_s3Treasure_a5',
    x: 305,
    y: 1218.463,
    scale: 1,
    imageX: -57.5,
    imageY: -940.8,
    width: 115,
    height: 64,
    from: 24.411,
    to: -25.77,
    initial: -9.963,
    duration: 10,
    delay: -6.85,
  },
  {
    file: 'img_s3Treasure_a0',
    x: 305,
    y: 1177.595,
    scale: 0.68,
    imageX: -54.499,
    imageY: -1397.537,
    width: 109,
    height: 157,
    from: 24.411,
    to: -25.77,
    initial: -4.109,
    duration: 10,
    delay: -5.683,
  },
  {
    file: 'img_s3Treasure_a2',
    x: 305,
    y: 1273.34,
    scale: 1,
    imageX: -45.5,
    imageY: -1023.887,
    width: 91,
    height: 93,
    from: 24.411,
    to: -25.77,
    initial: 24.411,
    duration: 10,
    delay: 0,
  },
  {
    file: 'img_s3Treasure_bg5',
    x: 305,
    y: 519,
    scale: 1,
    imageX: -360,
    imageY: -188,
    width: 720,
    height: 376,
  },
  {
    file: 'img_s3Treasure_a3',
    x: 305,
    y: 1168.3,
    scale: 1,
    imageX: -24,
    imageY: -832.3,
    width: 48,
    height: 41,
    from: 24.411,
    to: -25.77,
    initial: -14.145,
    duration: 10,
    delay: -7.683,
  },
  {
    file: 'img_s3Treasure_a4',
    x: 305,
    y: 1268.136,
    scale: 1,
    imageX: -18,
    imageY: -933.8,
    width: 36,
    height: 46,
    from: 24.411,
    to: -25.77,
    initial: 13.538,
    duration: 10,
    delay: -2.167,
  },
]
const art = (file: string) => `/activity/pet-diary/${file}.png`
</script>

<template>
  <svg class="escort-landscape" :class="{ 'escort-landscape--moving': running }" viewBox="0 0 610 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <image :href="art('img_s3Treasure_bg4')" width="610" height="570" />
    <g v-for="(part, index) in scenery" :key="index" :transform="`translate(${part.x} ${part.y})`">
      <g class="escort-orbit" :class="{ 'escort-orbit--animated': part.duration }" :style="{ '--from': `${part.from || 0}deg`, '--to': `${part.to || 0}deg`, '--initial': `${part.initial || 0}deg`, '--duration': `${part.duration || 1}s`, '--delay': `${part.delay || 0}s` }">
        <g :transform="`scale(${part.scale})`">
          <image :href="art(part.file)" :x="part.imageX" :y="part.imageY" :width="part.width" :height="part.height" />
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.escort-landscape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.escort-orbit {
  transform-origin: 0 0;
  transform: rotate(var(--initial));
}
.escort-landscape--moving .escort-orbit--animated {
  animation: pet-escort-orbit var(--duration) linear var(--delay) infinite;
}
@keyframes pet-escort-orbit {
  from {
    transform: rotate(var(--from));
  }
  to {
    transform: rotate(var(--to));
  }
}
@media (prefers-reduced-motion: reduce) {
  .escort-landscape--moving .escort-orbit--animated {
    animation: none;
  }
}
</style>
