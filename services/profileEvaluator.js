// Lightweight profile evaluator for LinkedIn / portfolio URLs
// Returns a score (0-100) and basic diagnostics

const url = require('url')

function evaluateProfileUrl(profileUrl) {
  let score = 0
  const diagnostics = []

  if (!profileUrl || typeof profileUrl !== 'string') {
    diagnostics.push('No URL')
    return { score: 0, diagnostics }
  }

  try {
    const parsed = new URL(profileUrl)
    const hostname = parsed.hostname.toLowerCase()

    // Prefer LinkedIn, GitHub, Behance, Dribbble, personal portfolio
    if (hostname.includes('linkedin.com')) {
      score += 40
      diagnostics.push('LinkedIn URL')
    }

    if (hostname.includes('github.com')) {
      score += 25
      diagnostics.push('GitHub URL')
    }

    if (hostname.includes('behance.net') || hostname.includes('dribbble.com') || hostname.includes('portfolio')) {
      score += 30
      diagnostics.push('Creative portfolio')
    }

    // Longer path suggests profile completeness
    const pathLen = parsed.pathname.length
    if (pathLen > 10) {
      score += 10
      diagnostics.push('Detailed path')
    }

    // Query params or anchors indicating activity (simplified heuristic)
    if (parsed.search || parsed.hash) {
      score += 5
      diagnostics.push('Has activity params')
    }

    // Bound score
    if (score > 100) score = 100
  } catch (err) {
    diagnostics.push('Invalid URL')
    return { score: 0, diagnostics }
  }

  return { score, diagnostics }
}

module.exports = {
  evaluateProfileUrl,
}