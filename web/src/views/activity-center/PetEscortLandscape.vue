<script setup lang="ts">
import PetMascot from './PetMascot.vue'

defineProps<{ running: boolean }>()
</script>

<template>
  <svg
    class="escort-landscape"
    :class="{ 'escort-landscape--running': running }"
    viewBox="0 0 320 190"
    preserveAspectRatio="xMidYMax meet"
    aria-hidden="true"
  >
    <ellipse cx="160" cy="168" rx="150" ry="20" fill="#f0e6d2" opacity=".7" />
    <path d="M14 160h292" fill="none" stroke="#d9c8a8" stroke-linecap="round" stroke-width="3" stroke-dasharray="2 12" />
    <g class="escort-landscape__prints" fill="#d9c8a8">
      <ellipse cx="86" cy="160" rx="6" ry="4" />
      <ellipse cx="120" cy="160" rx="6" ry="4" />
      <ellipse cx="154" cy="160" rx="6" ry="4" />
      <ellipse cx="188" cy="160" rx="6" ry="4" />
    </g>
    <g class="escort-landscape__walker">
      <svg x="26" y="82" width="76" height="76" viewBox="0 0 120 120">
        <PetMascot stage="adult" />
      </svg>
    </g>
    <g class="escort-landscape__box">
      <rect x="238" y="118" width="58" height="42" rx="9" fill="#e2ac60" />
      <rect x="238" y="108" width="58" height="18" rx="8" fill="#efc078" />
      <rect x="258" y="108" width="18" height="52" fill="#c98f3f" />
      <rect x="260" y="126" width="14" height="14" rx="3" fill="#fdf3dd" />
      <circle cx="267" cy="133" r="3.4" fill="#c98f3f" />
    </g>
    <g class="escort-landscape__sparkle" fill="#e8c98a">
      <circle cx="232" cy="96" r="4" />
      <circle cx="306" cy="112" r="3" />
      <circle cx="222" cy="132" r="2.6" />
    </g>
  </svg>
</template>

<style scoped>
.escort-landscape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.escort-landscape__walker,
.escort-landscape__box,
.escort-landscape__sparkle {
  transform-box: view-box;
}

.escort-landscape--running .escort-landscape__walker {
  animation: escort-walk 3.4s ease-in-out infinite alternate;
}

.escort-landscape--running .escort-landscape__box {
  animation: escort-bob 2.6s ease-in-out infinite;
}

.escort-landscape__prints {
  opacity: 0.8;
}

@keyframes escort-walk {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(96px);
  }
}

@keyframes escort-bob {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-3px);
  }
}
</style>
