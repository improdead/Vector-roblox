export const runtime = 'nodejs'

import { listProposals } from "../../lib/store/proposals"

export async function GET() {
  return Response.json({ proposals: listProposals() })
}

