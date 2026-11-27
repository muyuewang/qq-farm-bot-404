<script setup lang="ts">
import type { CollectionItemDto } from '@/utils/collections'
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { costLine, starDots } from '@/utils/collections'

const props = defineProps<{
  item: CollectionItemDto
  acting: boolean
  action: { canActivate: boolean, reason: string, canDisplay?: boolean, canHide?: boolean }
}>()

const emit = defineEmits<{
  upgrade: [item: CollectionItemDto]
  display: [item: CollectionItemDto, displayed: boolean]
}>()

const stars = computed(() => starDots(props.item))
const upgradeLabel = computed(() => (props.item.activated ? '升星' : '激活'))
</script>

<template>
  <article
    class="min-h-[228px] min-w-0 flex flex-col overflow-hidden border rounded-lg bg-white shadow-sm transition dark:bg-gray-800"
    :class="item.activated
      ? 'border-gray-200 hover:border-emerald-400 dark:border-gray-700'
      : item.unlocked
        ? 'border-dashed border-emerald-300 dark:border-emerald-700'
        : 'border-gray-200 opacity-80 dark:border-gray-700'"
  >
    <div class="relative grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
      <span class="absolute left-0 top-0 rounded-br-lg bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 font-semibold dark:bg-gray-700 dark:text-gray-300">
        #{{ item.id }}
      </span>
      <span
        class="absolute right-0 top-0 flex items-center gap-1 rounded-bl-lg px-2 py-0.5 text-[10px] font-semibold"
        :class="item.displayed
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
          : item.unlocked
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'"
      >
        <span v-if="item.isNew" class="i-carbon-star text-xs" />
        {{ item.displayed ? '展示中' : item.activated ? '已激活' : item.unlocked ? '可激活' : '未解锁' }}
      </span>
      <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-14 max-w-14 object-contain">
      <div v-else class="grid h-14 w-14 place-items-center rounded-lg bg-white text-sm text-gray-500 font-semibold dark:bg-gray-800">
        {{ item.name.slice(0, 1) || '?' }}
      </div>
    </div>

    <div class="min-h-[132px] flex flex-1 flex-col p-3">
      <div class="line-clamp-2 text-center text-sm text-gray-900 font-semibold dark:text-gray-100">
        {{ item.name }}
      </div>

      <div class="mt-1.5 flex items-center justify-center gap-0.5" :aria-label="`当前 ${stars.filled} 星，共 ${stars.total} 星`">
        <span
          v-for="index in stars.total"
          :key="index"
          class="text-xs"
          :class="index <= stars.filled ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'"
        >★</span>
        <span class="ml-1 text-[11px] text-gray-500 dark:text-gray-400">持有 {{ item.ownCount }}</span>
      </div>

      <div class="mt-2 text-[11px] text-gray-500 leading-5 space-y-1 dark:text-gray-400">
        <div v-if="!item.unlocked" class="line-clamp-2">
          {{ item.requirements.join('；') || '解锁条件待确认' }}
        </div>
        <template v-else-if="item.nextStarCosts.length">
          <div>{{ item.activated ? '升星消耗' : '激活消耗' }}</div>
          <div v-for="cost in item.nextStarCosts" :key="`${cost.itemId}`" class="flex items-center gap-1.5">
            <img v-if="cost.image" :src="cost.image" :alt="cost.name" class="h-4 w-4 shrink-0 rounded object-contain">
            <span class="truncate">{{ costLine(cost) }}</span>
          </div>
        </template>
        <div v-else-if="item.starLevel >= item.maxStarLevel" class="text-amber-600 dark:text-amber-400">
          已满星，当前贡献 {{ item.score }} 收藏分
        </div>
        <div v-else>
          {{ action.reason || '后端未下发升星材料' }}
        </div>
      </div>

      <div class="grid grid-cols-2 mt-auto gap-2 pt-2">
        <BaseButton
          size="sm"
          :variant="action.canActivate && item.canUpgrade ? 'primary' : 'secondary'"
          :disabled="!action.canActivate || !item.canUpgrade || acting"
          :title="action.reason"
          @click="emit('upgrade', item)"
        >
          {{ upgradeLabel }}
        </BaseButton>
        <BaseButton
          size="sm"
          variant="outline"
          :disabled="!item.activated || acting || (!action.canDisplay && !action.canHide)"
          @click="emit('display', item, !item.displayed)"
        >
          {{ item.displayed ? '取消展示' : '放上展台' }}
        </BaseButton>
      </div>
    </div>
  </article>
</template>
