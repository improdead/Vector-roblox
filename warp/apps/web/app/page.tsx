export default function Page() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji"' }}>
      <h1>Vector Web</h1>
      <p>Local API endpoints for the Roblox Studio copilot (Vector).</p>
      <ul>
        <li>POST /api/chat</li>
        <li>GET /api/proposals</li>
        <li>POST /api/proposals/[id]/apply</li>
        <li>GET /api/assets/search</li>
        <li>POST /api/assets/generate3d</li>
      </ul>
      <p>Running on localhost:3000 for development. We will move to Vercel later.</p>
    </main>
  )
}

