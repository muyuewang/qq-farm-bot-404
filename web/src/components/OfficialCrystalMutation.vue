<script setup lang="ts">
import '../styles/official-crystal-animation.css'
const starImage = '/game-config/effect_images/mutant/jinghui/star.png'
</script>

<template>
  <!-- Original prefab coordinates and default clip; viewBox scales it to the crop. -->
  <svg class="official-crystal-mutation" viewBox="-70 -70 140 140" aria-hidden="true">
    <g
      v-for="index in 9"
      :key="index"
      :style="{ animationName: `official-crystal-${index - 1}` }"
    >
      <image :href="starImage" x="-105" y="-105" width="210" height="210" />
    </g>
  </svg>
</template>

<style scoped>
.official-crystal-mutation {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 3;
}

.official-crystal-mutation g {
  animation-duration: 1.3333333333333333s;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

@media (prefers-reduced-motion: reduce) {
  .official-crystal-mutation g {
    animation-play-state: paused;
  }
}
</style>
