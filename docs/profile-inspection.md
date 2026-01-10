# Profile Inspection & Evaluation

This service inspects public profile URLs (GitHub, LinkedIn, portfolio sites, Instagram) to generate additional, role-aware evaluation signals.

Configuration (env):
- ENABLE_REMOTE_PROFILE_INSPECTION (default: `false`) — enable remote inspection
- GITHUB_TOKEN (optional) — GitHub API token for higher rate limits and richer data

How it works:
- On `applyForJob` (online jobs), the system will enqueue a remote inspection (if enabled) which:
  - Detects platform (GitHub, LinkedIn, Portfolio, Instagram)
  - For GitHub: uses the GitHub API to assess repos, recent activity, and language relevance
  - For other sites: fetches HTML (with timeout and safe UA) and looks for project indicators, tool usage, and skill keywords (includes Instagram profile inspection for creative roles).
- The queue worker updates the application's `evaluationScore` by combining the base URL heuristic score with the inspection delta.
- Employers can force an immediate inspection using: `POST /api/jobs/:id/applications/:applicationId/inspect` (employer or admin only).

Privacy & safety:
- Only public data is used.
- Remote inspection is disabled by default; enable explicitly via env var.
- Avoid scraping sites that disallow bots; prefer official APIs (e.g., GitHub).

Notes:
- This is a conservative implementation: it avoids heavy scraping and uses best-effort heuristics. It can be extended to add richer parsers or API integrations later.
