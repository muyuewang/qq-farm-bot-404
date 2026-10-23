<script setup lang="ts">
withDefaults(defineProps<{ stage?: 'puppy' | 'adult', animated?: boolean }>(), {
  stage: 'adult',
  animated: false,
})
</script>

<template>
  <svg
    class="pet-mascot"
    :class="{ 'pet-mascot--idle': animated }"
    viewBox="0 0 120 120"
    role="img"
    :aria-label="stage === 'adult' ? '成年比熊犬' : '幼年比熊犬'"
  >
    <ellipse cx="60" cy="114" :rx="stage === 'adult' ? 31 : 26" ry="5.2" fill="#2b2115" opacity=".08" />
    <template v-if="stage === 'adult'">
      <circle cx="100" cy="84" r="13" fill="#fdf6ea" />
      <circle cx="108" cy="72" r="9" fill="#fdf6ea" />
      <rect x="36" y="94" width="15" height="18" rx="7.5" fill="#fdf6ea" />
      <rect x="69" y="94" width="15" height="18" rx="7.5" fill="#fdf6ea" />
      <ellipse cx="60" cy="86" rx="34" ry="27" fill="#fffdf8" />
      <circle cx="30" cy="76" r="12" fill="#fffdf8" />
      <circle cx="90" cy="76" r="12" fill="#fffdf8" />
      <circle cx="45" cy="63" r="14" fill="#fffdf8" />
      <circle cx="75" cy="63" r="14" fill="#fffdf8" />
      <ellipse cx="25" cy="45" rx="11" ry="17" fill="#fbf1e0" transform="rotate(-13 25 45)" />
      <ellipse cx="95" cy="45" rx="11" ry="17" fill="#fbf1e0" transform="rotate(13 95 45)" />
      <circle cx="34" cy="36" r="14" fill="#fffdf8" />
      <circle cx="86" cy="36" r="14" fill="#fffdf8" />
      <circle cx="46" cy="20" r="13" fill="#fffdf8" />
      <circle cx="74" cy="20" r="13" fill="#fffdf8" />
      <circle cx="60" cy="16" r="14" fill="#fffdf8" />
      <ellipse cx="60" cy="42" rx="30" ry="29" fill="#fffdf8" />
      <ellipse cx="40" cy="50" rx="7.5" ry="5" fill="#f5c9bd" opacity=".72" />
      <ellipse cx="80" cy="50" rx="7.5" ry="5" fill="#f5c9bd" opacity=".72" />
      <circle cx="48" cy="42" r="3.7" fill="#41382f" />
      <circle cx="72" cy="42" r="3.7" fill="#41382f" />
      <circle cx="49.3" cy="40.7" r="1.25" fill="#fff" />
      <circle cx="73.3" cy="40.7" r="1.25" fill="#fff" />
      <ellipse cx="60" cy="52" rx="5.2" ry="3.9" fill="#4a3d33" />
      <path d="M60 56v3.4" fill="none" stroke="#4a3d33" stroke-width="1.7" stroke-linecap="round" />
      <path d="M60 59.4c-2.4 3.1-7.6 2.5-8.6-1" fill="none" stroke="#4a3d33" stroke-width="1.7" stroke-linecap="round" />
      <path d="M60 59.4c2.4 3.1 7.6 2.5 8.6-1" fill="none" stroke="#4a3d33" stroke-width="1.7" stroke-linecap="round" />
      <path d="M33 62c9 7 45 7 54 0 2.2 6 2.2 12.5 0 17-11 7-43 7-54 0-2.2-4.5-2.2-11 0-17Z" fill="#e6a058" />
      <path d="M78 78c4 6 5 12 2 16-4 1-7-6-6-13Z" fill="#d9903f" />
    </template>
    <template v-else>
      <circle cx="96" cy="90" r="11" fill="#fdf6ea" />
      <circle cx="103" cy="80" r="7.5" fill="#fdf6ea" />
      <rect x="42" y="98" width="13" height="15" rx="6.5" fill="#fdf6ea" />
      <rect x="68" y="98" width="13" height="15" rx="6.5" fill="#fdf6ea" />
      <ellipse cx="60" cy="92" rx="28" ry="22" fill="#fffdf8" />
      <circle cx="37" cy="84" r="10" fill="#fffdf8" />
      <circle cx="83" cy="84" r="10" fill="#fffdf8" />
      <ellipse cx="28" cy="44" rx="10" ry="15" fill="#fbf1e0" transform="rotate(-13 28 44)" />
      <ellipse cx="92" cy="44" rx="10" ry="15" fill="#fbf1e0" transform="rotate(13 92 44)" />
      <circle cx="34" cy="38" r="14" fill="#fffdf8" />
      <circle cx="86" cy="38" r="14" fill="#fffdf8" />
      <circle cx="46" cy="22" r="13" fill="#fffdf8" />
      <circle cx="74" cy="22" r="13" fill="#fffdf8" />
      <circle cx="60" cy="18" r="14" fill="#fffdf8" />
      <ellipse cx="60" cy="45" rx="30" ry="29" fill="#fffdf8" />
      <ellipse cx="41" cy="53" rx="7.5" ry="5" fill="#f5c9bd" opacity=".72" />
      <ellipse cx="79" cy="53" rx="7.5" ry="5" fill="#f5c9bd" opacity=".72" />
      <circle cx="48" cy="45" r="3.7" fill="#41382f" />
      <circle cx="72" cy="45" r="3.7" fill="#41382f" />
      <circle cx="49.3" cy="43.7" r="1.25" fill="#fff" />
      <circle cx="73.3" cy="43.7" r="1.25" fill="#fff" />
      <ellipse cx="60" cy="55" rx="5" ry="3.7" fill="#4a3d33" />
      <path d="M60 58.7v3" fill="none" stroke="#4a3d33" stroke-width="1.7" stroke-linecap="round" />
      <path d="M60 61.7c-2.2 2.9-7 2.3-8-.9" fill="none" stroke="#4a3d33" stroke-width="1.7" stroke-linecap="round" />
      <path d="M60 61.7c2.2 2.9 7 2.3 8-.9" fill="none" stroke="#4a3d33" stroke-width="1.7" stroke-linecap="round" />
      <path d="M36 74c8 5 40 5 48 0" fill="none" stroke="#7fa8c9" stroke-width="5" stroke-linecap="round" />
      <circle cx="60" cy="77" r="4.6" fill="#e0b352" />
    </template>
  </svg>
</template>

<style scoped>
.pet-mascot {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.pet-mascot--idle {
  animation: pet-mascot-idle 3.6s ease-in-out infinite;
}

@keyframes pet-mascot-idle {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-4%);
  }
}
</style>
