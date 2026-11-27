import type { GameScene } from '@/stores/scene'

export interface MenuItem {
  path: string
  name: string
  label: string
  icon: string
  component: () => Promise<any>
  adminOnly?: boolean
  showInNav?: boolean
  /** 该页面属于哪些浏览场景；不填表示两个场景都显示（概览、设置这类与场景无关的页面）。 */
  scenes?: GameScene[]
}

/**
 * 农场和牧场是同一个账号下的两个游戏场景，背包、商店、图鉴、好友在两边各有一套协议。
 * 这里不再单列「牧场」入口：同一个子系统长两份页面会让人分不清当前在看哪一边，
 * 改由顶部栏的场景开关整体切换，菜单跟着换，页面内部再按场景渲染对应面板。
 */
export const menuRoutes: MenuItem[] = [
  {
    path: '',
    name: 'dashboard',
    label: '概览',
    icon: 'i-carbon-chart-pie',
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: 'personal',
    name: 'personal',
    label: '个人',
    icon: 'i-carbon-user',
    component: () => import('@/views/Personal.vue'),
  },
  {
    path: 'friends',
    name: 'friends',
    label: '好友',
    icon: 'i-carbon-user-multiple',
    component: () => import('@/views/Friends.vue'),
  },
  {
    path: 'pet',
    name: 'pet',
    label: '宠物',
    icon: 'i-fas-paw',
    component: () => import('@/views/Pet.vue'),
    scenes: ['farm'],
  },
  {
    path: 'activity',
    name: 'activity',
    label: '活动',
    icon: 'i-carbon-gift',
    component: () => import('@/views/Activity.vue'),
  },
  {
    path: 'shop',
    name: 'shop',
    label: '商城',
    icon: 'i-carbon-shopping-cart',
    component: () => import('@/views/Shop.vue'),
  },
  {
    path: 'illustrated',
    name: 'illustrated',
    label: '图鉴',
    icon: 'i-carbon-book',
    component: () => import('@/views/Illustrated.vue'),
  },
  {
    path: 'analytics',
    name: 'analytics',
    label: '分析',
    icon: 'i-carbon-analytics',
    component: () => import('@/views/Analytics.vue'),
    scenes: ['farm'],
  },
  {
    path: 'currency-ledger',
    name: 'currencyLedger',
    label: '流水',
    icon: 'i-carbon-receipt',
    component: () => import('@/views/CurrencyLedger.vue'),
  },
  {
    path: 'settings',
    name: 'Settings',
    label: '设置',
    icon: 'i-carbon-settings',
    component: () => import('@/views/Settings.vue'),
  },
]
