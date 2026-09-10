// Rush backend: one Vercel serverless function for the persona generator and the waitlist.
// Vercel → Project → Settings → Environment Variables:
//   ANTHROPIC_API_KEY      required (console.anthropic.com)
//   WAITLIST_WEBHOOK_URL   optional: any URL that accepts a JSON POST; every signup is sent there
let count = 0;
 
module.exports = async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ count });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = req.body || {};
 
  if (body.action === "waitlist") {
    const { email = "", role = "brand", note = "", wallet = null } = body;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Invalid email" });
    try {
      if (process.env.WAITLIST_WEBHOOK_URL) {
        await fetch(process.env.WAITLIST_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, role, note: String(note).slice(0, 500), wallet, at: new Date().toISOString(), source: "rush" }) });
      }
      count += 1;
      return res.status(200).json({ ok: true, count });
    } catch (e) { return res.status(500).json({ error: "Could not save signup" }); }
  }
 
  if (body.action === "spawn") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel" });
    const { owner = "brand", ownerName = "", niche = "", tone = "Warm and direct", goal = "", seed = Date.now() } = body;
    if (!ownerName.trim() || !niche.trim()) return res.status(400).json({ error: "ownerName and niche are required" });
    const system = `You design disclosed AI personas for the Rush platform. Return ONLY a JSON object, no markdown, no preamble, with keys:
name, handle (like @something), intro (one spoken sentence introducing themselves, saying they are an AI persona for the owner),
voice {gender: "male"|"female"|"neutral", rate: number 0.85-1.2, pitch: number 0.8-1.3, description: 8-14 words on how they sound},
personality (2 sentences), backstory (2-3 sentences, plainly fictional, never claiming real credentials),
posts (array of 3 short social posts under 40 words each, in the persona's voice),
disclosure (one short line the persona uses to tell audiences it is an AI run by the owner).
Never present the persona as a real human. Variation seed: ${seed}.`;
    const user = `Owner type: ${owner}. Owner name: ${ownerName}. Niche/audience: ${niche}. Tone: ${tone}. Job: ${goal || "engage the audience and represent the owner"}.`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6", max_tokens: 1000, system, messages: [{ role: "user", content: user }] }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: d.error?.message || "Upstream error" });
      const text = (d.content || []).map((c) => c.text || "").join("").replace(/```json|```/g, "").trim();
      return res.status(200).json({ persona: JSON.parse(text) });
    } catch (e) { return res.status(500).json({ error: e.message || "Failed to generate persona" }); }
  }
  return res.status(400).json({ error: "Unknown action" });
};
 
