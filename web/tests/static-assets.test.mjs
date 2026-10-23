import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- This project uses the Node.js test runner.
import test from 'node:test'

test('the favicon is a passive, self-contained SVG', async () => {
  const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8')
  assert.match(svg, /<svg\b/i)
  assert.doesNotMatch(svg, /<\s*(?:script|foreignObject|iframe|object|embed|image|use|animate\w*|set)\b/i)
  assert.doesNotMatch(svg, /\bon[a-z]+\s*=/i)
  assert.doesNotMatch(svg, /<!\s*(?:DOCTYPE|ENTITY)\b/i)
  for (const reference of svg.matchAll(/\b(?:href|xlink:href)\s*=\s*(['"])(.*?)\1/gi))
    assert.match(reference[2], /^#[\w-]+$/)
  for (const reference of svg.matchAll(/url\(\s*['"]?([^)'"\s]+)/gi))
    assert.match(reference[1], /^#[\w-]+$/)
})

test('the entry page does not load embedded documents or remote scripts', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /<\s*(?:iframe|object|embed)\b/i)
  for (const script of html.matchAll(/<script\b[^>]+\bsrc\s*=\s*(['"])(.*?)\1/gi))
    assert.match(script[2], /^\/(?!\/)/)
})
