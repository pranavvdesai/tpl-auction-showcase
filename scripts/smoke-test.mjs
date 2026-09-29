// Verifies a deployed build: routes resolve, the bundle loads and Supabase settings are baked in.
// Usage: node scripts/smoke-test.mjs https://your-deployment.vercel.app
const base = (process.argv[2] || process.env.SMOKE_URL || '').replace(/\/+$/, '')
if (!base) {
  console.error('Pass the deployment URL: node scripts/smoke-test.mjs https://...')
  process.exit(1)
}

let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  PASS  ${name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL  ${name}\n        ${e.message}`)
  }
}

let html = ''
for (const route of ['/', '/login', '/operator', '/import', '/projection']) {
  await check(`GET ${route} serves the app shell`, async () => {
    const res = await fetch(base + route, { redirect: 'follow' })
    if (res.status !== 200) throw new Error(`status ${res.status}`)
    const body = await res.text()
    if (!body.includes('<div id="root">')) throw new Error('app shell not found')
    html = body
  })
}

await check('JavaScript bundle loads and contains the Supabase project URL', async () => {
  const src = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1]
  if (!src) throw new Error('bundle script tag not found')
  const res = await fetch(new URL(src, base))
  if (res.status !== 200) throw new Error(`bundle status ${res.status}`)
  const js = await res.text()
  if (!/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(js)) throw new Error('Supabase URL missing from bundle (env vars not set at build time)')
  const importChunk = js.match(/Import-[\w-]+\.js/)?.[0]
  if (!importChunk) throw new Error('import page chunk is not referenced by the bundle')
  const chunk = await fetch(new URL(importChunk, new URL(src, base)))
  if (chunk.status !== 200) throw new Error(`import chunk status ${chunk.status}`)
})

await check('logo asset is served', async () => {
  const res = await fetch(base + '/sportscom-logo.jpeg')
  if (res.status !== 200 || !res.headers.get('content-type')?.includes('image')) throw new Error(`status ${res.status}`)
})

await check('sold music is served', async () => {
  const res = await fetch(`${base}/sounds/sold-music.mp3`)
  if (res.status !== 200 || !res.headers.get('content-type')?.includes('audio')) throw new Error(`status ${res.status}`)
})

console.log(failed ? `\n${failed} check(s) failed` : '\nAll smoke checks passed')
process.exit(failed ? 1 : 0)
