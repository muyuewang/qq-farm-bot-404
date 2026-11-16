import type { Ref } from 'vue'
import { nextTick, onBeforeUnmount, watch } from 'vue'

const modalStack: HTMLElement[] = []
let previousOverflow: string | null = null
const inertNodes = new Map<HTMLElement, boolean>()
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function syncBackground() {
  for (const [node, previous] of inertNodes)
    node.inert = previous
  inertNodes.clear()
  const top = modalStack[modalStack.length - 1]
  if (!top) {
    if (previousOverflow !== null)
      document.body.style.overflow = previousOverflow
    previousOverflow = null
    return
  }
  if (previousOverflow === null)
    previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  let branch: HTMLElement = top
  while (branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        inertNodes.set(sibling, sibling.inert)
        sibling.inert = true
      }
    }
    branch = branch.parentElement
  }
}

/** Shared focus lifecycle for modal surfaces, including nested dialogs. */
export function useModalFocus(show: () => boolean, surface: Ref<HTMLElement | null>, close: () => void) {
  let previousFocus: HTMLElement | null = null
  let registered: HTMLElement | null = null
  let revision = 0

  function candidates() {
    return Array.from(surface.value?.querySelectorAll<HTMLElement>(focusableSelector) || [])
      .filter(el => !el.closest('[inert]') && el.getClientRects().length > 0 && el.getAttribute('aria-disabled') !== 'true')
  }

  function onKeydown(event: KeyboardEvent) {
    if (!registered || modalStack[modalStack.length - 1] !== registered)
      return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    if (event.key === 'Tab') {
      const items = candidates()
      const first = items[0]
      const last = items[items.length - 1]
      if (!first) {
        event.preventDefault()
        surface.value?.focus()
      }
      else if (event.shiftKey && (document.activeElement === first || !surface.value?.contains(document.activeElement))) {
        event.preventDefault()
        last?.focus()
      }
      else if (!event.shiftKey && (document.activeElement === last || !surface.value?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  function release() {
    revision++
    document.removeEventListener('keydown', onKeydown)
    if (registered) {
      const index = modalStack.indexOf(registered)
      if (index >= 0)
        modalStack.splice(index, 1)
      registered = null
      syncBackground()
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]'))
        previousFocus.focus()
    }
    previousFocus = null
  }

  watch(show, async (visible) => {
    release()
    if (!visible)
      return
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const token = revision
    await nextTick()
    if (token !== revision || !show() || !surface.value)
      return
    registered = surface.value
    modalStack.push(registered)
    syncBackground()
    document.addEventListener('keydown', onKeydown)
    ;(candidates()[0] || registered).focus()
  }, { immediate: true })

  onBeforeUnmount(release)
}
