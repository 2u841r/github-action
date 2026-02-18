const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER   = process.env.REPO_OWNER;
const REPO_NAME    = process.env.REPO_NAME;

export default async function handler(req, res) {
  // Allow CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { phone } = req.query;

  if (!phone) {
    return res.status(400).json({ error: "Phone number required" });
  }

  try {
    // Step 1: Trigger GitHub Action
    const triggerRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "fraud-check",
          client_payload: { phone },
        }),
      }
    );

    if (!triggerRes.ok) {
      return res.status(500).json({ error: "Failed to trigger action" });
    }

    // Step 2: Poll for Gist result (max 30 attempts x 3s = 90s)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      const gistsRes = await fetch("https://api.github.com/gists", {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      });

      const gists = await gistsRes.json();
      const match = gists.find(
        (g) => g.description === `Fraud check result for ${phone}`
      );

      if (match) {
        // Fetch full gist content
        const detail = await fetch(match.url, {
          headers: { Authorization: `token ${GITHUB_TOKEN}` },
        });
        const data = await detail.json();
        const fileKey = Object.keys(data.files)[0];
        const content = data.files[fileKey].content;

        // Delete gist after reading
        await fetch(match.url, {
          method: "DELETE",
          headers: { Authorization: `token ${GITHUB_TOKEN}` },
        });

        try {
          return res.status(200).json(JSON.parse(content));
        } catch {
          return res.status(200).json({ result: content });
        }
      }
    }

    return res.status(504).json({ error: "Timeout: no result received" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
