import { defineStore } from 'pinia'
import { ref } from 'vue'

const SCENE_KEY = 'game_scene'

export type GameScene = 'farm' | 'ranch'

/** 整站按场景换皮：顶栏和侧栏读这一份，避免两处各写一套中文名。 */
export const SCENE_BRAND: Record<GameScene, { title: string, subtitle: string }> = {
  farm: { title: 'QQ农场智能助手', subtitle: 'QQ FARM ASSISTANT' },
  ranch: { title: 'QQ牧场智能助手', subtitle: 'QQ RANCH ASSISTANT' },
}

export const useSceneStore = defineStore('scene', () => {
  const scene = ref<GameScene>(localStorage.getItem(SCENE_KEY) === 'ranch' ? 'ranch' : 'farm')

  function setScene(value: GameScene) {
    scene.value = value
    localStorage.setItem(SCENE_KEY, value)
  }

  return {
    scene,
    setScene,
  }
})
