export const runtime = 'nodejs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  const limit = Number(searchParams.get('limit') || '8')
  // TODO: Hook up to Roblox Catalog via backend integration
  return Response.json({ results: [], q, limit })
}

