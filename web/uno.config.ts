import { defineConfig, presetAttributify, presetIcons, presetUno } from 'unocss'

export default defineConfig({
  theme: {
    fontFamily: {
      sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      serif: 'Georgia, "Times New Roman", serif',
      mono: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
      display: '"Microsoft YaHei", "PingFang SC", ui-sans-serif, system-ui, sans-serif',
    },
  },
  shortcuts: {
    'cartoon-card': 'rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] transition-colors',
    'farm-gradient': 'bg-[var(--ui-primary)]',
    'farm-gradient-warm': 'bg-[var(--ui-warning)]',
    'soil-bg': 'bg-gradient-to-b from-[#8b6914] to-[#6b4f0e]',
    'grass-bg': 'bg-gradient-to-b from-[#6dbf5b] to-[#4a8c3f]',
    'sky-bg': 'bg-gradient-to-b from-[#b8e4f7] to-[#87ceeb]',
    'farm-card': 'cartoon-card p-4 shadow-sm',
    'farm-panel': 'cartoon-card p-5 shadow-sm',
    'farm-input': 'rounded-md border px-3 py-2 outline-none transition-colors focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary)]/20',
    'farm-badge': 'inline-flex items-center rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium dark:border-gray-700',
    'farm-title': 'font-display text-xl text-gray-900 dark:text-gray-100',
    'farm-text': 'font-body text-gray-700 dark:text-gray-300',
    'wood-frame': 'rounded-lg border-2 border-[#8b6914] shadow-sm',
    'grass-land': 'rounded-lg border-2 border-[#3a6b2e] bg-[#4a8c3f]',
    'soil-land': 'rounded-lg border-2 border-[#6b4f0e] bg-[#8b6914]',
  },
  content: {
    pipeline: {
      include: [
        /\.(vue|svelte|[jt]sx|mdx?|astro|elm|php|phtml|html)($|\?)/,
        'src/**/*.{js,ts}',
      ],
    },
  },
  presets: [
    presetUno(),
    // Attribute utilities use un-* so Vue expressions are not parsed as icon names.
    presetAttributify({ prefixedOnly: true }),
    presetIcons({
      scale: 1.2,
      warn: true,
      collections: {
        'carbon': () => import('@iconify-json/carbon/icons.json').then(i => i.default),
        'fas': () => import('@iconify-json/fa-solid/icons.json').then(i => i.default),
        'svg-spinners': () => import('@iconify-json/svg-spinners/icons.json').then(i => i.default),
      },
    }),
  ],
})
