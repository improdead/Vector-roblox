// Simple smoke test: query Roblox catalog and print a couple results
// This approximates the backend /api/assets/search without requiring Next.js runtime.

async function main() {
  const params = new URLSearchParams({
    Category: 'Models',
    Keyword: 'tree',
    Limit: '10',
    SortAggregation: '3',
    SortType: '3',
  })
  const url = `https://catalog.roblox.com/v1/search/items/details?${params.toString()}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    console.error('Roblox catalog HTTP error', res.status)
    process.exit(2)
  }
  const json = await res.json()
  const data = Array.isArray(json && json.data) ? json.data : []
  console.log('items', data.length)
  if (data[0]) {
    console.log('first', { id: data[0].id, name: data[0].name })
  }
}

main().catch((e) => { console.error('test failed', e); process.exit(1) })

