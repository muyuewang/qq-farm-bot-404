import { useStorage } from '@vueuse/core'
import NProgress from 'nprogress'
import { createRouter, createWebHistory } from 'vue-router'
import { menuRoutes } from './menu'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

const adminToken = useStorage('admin_token', '')

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      children: menuRoutes.map(route => ({
        path: route.path,
        name: route.name,
        component: route.component,
      })),
    },
    { path: '/login', name: 'login', component: () => import('@/views/Login.vue') },
    { path: '/admin', redirect: '/settings?tab=system' },
    { path: '/renewal', redirect: '/' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  NProgress.start()
  // 上游后端只签发 x-admin-token，没有免密入口；未登录时统一去登录页并记住来路。
  if (!adminToken.value && to.name !== 'login') {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }
  if (adminToken.value && to.name === 'login')
    return { path: '/' }
  return true
})

router.afterEach(() => NProgress.done())

export default router
