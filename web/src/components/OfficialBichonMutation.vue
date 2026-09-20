<script setup lang="ts">
const bichonMaskImage = '/game-config/effect_images/mutant/bichon/11.png'
</script>

<template>
  <img
    :src="bichonMaskImage"
    class="official-bichon-mutation"
    alt=""
    aria-hidden="true"
  >
</template>

<style scoped>
.official-bichon-mutation {
  position: absolute;
  z-index: 4;
  left: 50%;
  top: 50%;
  width: 155%;
  height: 155%;
  max-width: none;
  transform: translate(-50%, -50%);
  object-fit: contain;
  pointer-events: none;
  filter: drop-shadow(0 1px 1px rgb(92 65 22 / 24%));
}
</style>
