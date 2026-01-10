const axios = require('axios')
let cheerio
try {
  cheerio = require('cheerio')
} catch (err) {
  console.warn('cheerio not installed — HTML/profile inspection disabled. Install `cheerio` for full functionality.')
  cheerio = null
}

const GITHUB_API = 'https://api.github.com' 
const DEFAULT_TIMEOUT = 5000

function detectPlatform(profileUrl) {
  try {
    const parsed = new URL(profileUrl)
    const hostname = parsed.hostname.toLowerCase()
    if (hostname.includes('github.com')) return 'github'
    if (hostname.includes('linkedin.com')) return 'linkedin'
    if (hostname.includes('behance.net') || hostname.includes('dribbble.com') || hostname.includes('portfolio') || hostname.includes('figma.com') || hostname.includes('webflow.io')) return 'portfolio'
    if (hostname.includes('instagram.com')) return 'instagram'
    // fallback to generic web
    return 'website'
  } catch (err) {
    return 'unknown'
  }
}

async function inspectGithubProfile(profileUrl, jobContext = {}) {
  // profileUrl expected format: https://github.com/{username} or deeper paths
  try {
    const parsed = new URL(profileUrl)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (!parts.length) return { success: false, reason: 'Invalid GitHub URL' }

    const username = parts[0]
    const token = process.env.GITHUB_TOKEN
    const headers = token ? { Authorization: `token ${token}` } : {}

    // fetch repos (public) - up to 100
    const reposRes = await axios.get(`${GITHUB_API}/users/${username}/repos?per_page=100`, { headers, timeout: DEFAULT_TIMEOUT })
    const repos = reposRes.data || []

    // basic signals
    const repoCount = repos.length
    const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0)
    const recentActivityCount = repos.filter(r => {
      const pushed = r.pushed_at ? new Date(r.pushed_at) : null
      if (!pushed) return false
      const sixMonthsAgo = new Date()
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
      return pushed >= sixMonthsAgo
    }).length

    // language relevance: count repos with language matching job skills
    const jobSkills = (jobContext.skills || []).map(s => String(s).toLowerCase())
    let relevantRepoCount = 0
    repos.forEach(r => {
      const lang = (r.language || '').toLowerCase()
      if (jobSkills.length && lang && jobSkills.some(js => lang.includes(js))) relevantRepoCount++
    })

    // simple heuristics to compute score delta (0-60)
    let scoreDelta = 0
    if (repoCount >= 3) scoreDelta += 15
    if (totalStars >= 10) scoreDelta += 10
    if (recentActivityCount >= 1) scoreDelta += 20
    if (relevantRepoCount >= 1) scoreDelta += 15

    const details = {
      platform: 'github',
      username,
      repoCount,
      totalStars,
      recentActivityCount,
      relevantRepoCount,
    }

    return { success: true, extraScore: Math.min(60, scoreDelta), details }
  } catch (err) {
    return { success: false, reason: err.message }
  }
}

async function inspectHtmlProfile(profileUrl, jobContext = {}) {
  try {
    const res = await axios.get(profileUrl, { timeout: DEFAULT_TIMEOUT, headers: { 'User-Agent': 'ProfileInspector/1.0 (+https://example.com)' } })
    const html = res.data || ''
    if (!cheerio) return { success: false, reason: 'HTML inspection unavailable: missing dependency cheerio' }
    const $ = cheerio.load(html)

    const text = $('body').text().replace(/\s+/g, ' ').toLowerCase()
    const title = ($('title').text() || '').toLowerCase()

    const jobSkills = (jobContext.skills || []).map(s => String(s).toLowerCase())

    // detect number of project-like sections
    const projectKeywords = ['project', 'case study', 'portfolio', 'work', 'projects', 'works']
    let projectHits = 0
    projectKeywords.forEach(k => { if (text.includes(k)) projectHits++ })

    // tool presence
    const tools = ['figma', 'adobe', 'photoshop', 'illustrator', 'framer', 'webflow', 'sketch', 'react', 'node', 'python', 'django', 'flask', 'docker']
    const toolsFound = tools.filter(t => text.includes(t))

    // skill match count
    const skillMatchCount = jobSkills.filter(s => text.includes(s)).length

    // recency heuristics via meta or timestamps in page (best-effort)
    // fallback: presence of 'last updated' or recent year
    const recent = /\b(202[2-6]|2021|2020)\b/.test(text)

    // score heuristics
    let scoreDelta = 0
    if (projectHits >= 1) scoreDelta += 20
    if (toolsFound.length >= 2) scoreDelta += 15
    if (skillMatchCount >= 1) scoreDelta += Math.min(20, skillMatchCount * 8)
    if (recent) scoreDelta += 10

    const details = { platform: 'website', title, projectHits, toolsFound, skillMatchCount }

    return { success: true, extraScore: Math.min(60, scoreDelta), details }
  } catch (err) {
    return { success: false, reason: err.message }
  }
}

// LinkedIn-specific evaluator (conservative, uses public page HTML only)
async function inspectLinkedInProfile(profileUrl, jobContext = {}) {
  try {
    const res = await axios.get(profileUrl, { timeout: DEFAULT_TIMEOUT, headers: { 'User-Agent': 'ProfileInspector/1.0 (+https://example.com)' } })
    const html = res.data || ''
    // Detect if LinkedIn blocked access
    const blocked = /sign in to linkedin|member profile|login required|https:\/\/www.linkedin.com\/checkpoint\/verify/ig.test(html.toLowerCase())
    if (blocked) {
      return { success: true, confidence: 'low', experienceScore: 0, skillEvidenceScore: 0, activityScore: 0, summary: 'LinkedIn page requires login or is blocked; public data inaccessible.' }
    }

    if (!cheerio) return { success: false, reason: 'HTML inspection unavailable: missing dependency cheerio' }
    const $ = cheerio.load(html)
    const bodyText = $('body').text().replace(/\s+/g, ' ').toLowerCase()
    const title = ($('title').text() || '').toLowerCase()

    const jobSkills = (jobContext.skills || []).map(s => String(s).toLowerCase())
    const role = (jobContext.role || '').toLowerCase()

    // Headline / About
    let headline = ''
    let about = ''
    // try common selectors
    headline = $('h1').first().text().trim() || headline
    about = $('section.pv-about-section, #about, .summary').text().trim() || about

    // Experience section detection
    const expText = bodyText.match(/experience[\s\S]{0,500}/) ? bodyText : bodyText

    // Experience score (0-10)
    let experienceScore = 0
    const roleMatches = (role ? (bodyText.match(new RegExp(role, 'g')) || []).length : 0)
    const internMatches = (bodyText.match(/intern(ship)?|internships|freelance|contract/g) || []).length

    if (roleMatches >= 2) experienceScore = 10
    else if (roleMatches === 1) experienceScore = 6
    else if (internMatches >= 1) experienceScore = Math.min(6, 3 + internMatches)
    else experienceScore = 0

    // Skill evidence score (0-10)
    const skillMatchCount = jobSkills.filter(s => bodyText.includes(s)).length
    // detect project/external links
    const links = $('a').map((i, el) => $(el).attr('href')).get().filter(Boolean)
    const hasProjectLinks = links.some(l => /github.com|behance.net|dribbble.com|portfolio|figma.com|webflow.io/.test(l))
    let skillEvidenceScore = 0
    if (skillMatchCount >= 3 && hasProjectLinks) skillEvidenceScore = 10
    else if (skillMatchCount >= 2 || (skillMatchCount >=1 && hasProjectLinks)) skillEvidenceScore = 7
    else if (skillMatchCount === 1) skillEvidenceScore = 3
    else skillEvidenceScore = 0

    // Activity score (0-4)
    // look for recent years or 'posted' / 'updated' / 'published'
    const recentYearMatch = bodyText.match(/\b(202[3-6]|2022|2021)\b/)
    let activityScore = 0
    if (recentYearMatch) {
      const year = parseInt(recentYearMatch[0], 10)
      const now = new Date().getFullYear()
      const age = now - year
      if (age === 0) activityScore = 4
      else if (age === 1) activityScore = 3
      else activityScore = 2
    } else if (/posted|published|updated/.test(bodyText)) {
      activityScore = 2
    }

    // Confidence
    let confidence = 'medium'
    const dataPoints = [headline, about, roleMatches, skillMatchCount, links.length]
    const dataCount = dataPoints.filter(Boolean).length
    if (dataCount >= 4) confidence = 'high'
    else if (dataCount <= 1) confidence = 'low'

    // compose summary
    const summaryParts = []
    if (headline) summaryParts.push(`Headline: "${headline.split('\n')[0].slice(0, 100)}"`)
    if (experienceScore >= 6) summaryParts.push('Experience aligned with role')
    if (internMatches) summaryParts.push(`${internMatches} internship/freelance mentions`)
    if (skillEvidenceScore >= 7) summaryParts.push('Skills mentioned with project links')
    if (activityScore >= 3) summaryParts.push('Recent activity detected')
    if (summaryParts.length === 0) summaryParts.push('Limited public data; results best-effort')

    const summary = summaryParts.join('. ')

    // Map component scores into an extraScore (0-60) for compatibility with inspection pipeline
    const rawCombined = (experienceScore * 3) + (skillEvidenceScore * 3) + (activityScore * 3) // max ~72
    const extraScore = Math.min(60, Math.round(rawCombined))

    const details = {
      platform: 'LinkedIn',
      experienceScore,
      skillEvidenceScore,
      activityScore,
      confidenceLevel: confidence,
      summary,
    }

    return { success: true, extraScore, details }
  } catch (err) {
    return { success: false, reason: `Failed to fetch or parse LinkedIn page: ${err.message}` }
  }
}

// Portfolio-specific evaluation
async function inspectPortfolioProfile(profileUrl, jobContext = {}) {
  try {
    const res = await axios.get(profileUrl, { timeout: DEFAULT_TIMEOUT, headers: { 'User-Agent': 'ProfileInspector/1.0 (+https://example.com)' } })
    const html = res.data || ''
    if (!cheerio) return { success: false, reason: 'HTML inspection unavailable: missing dependency cheerio' }
    const $ = cheerio.load(html)
    const bodyText = $('body').text().replace(/\s+/g, ' ').toLowerCase()

    // Detect projects / case studies
    const projectHeadings = $('h1,h2,h3,h4').filter((i, el) => {
      const t = $(el).text().toLowerCase()
      return /project|case study|portfolio|work|works/.test(t)
    })
    const hasProjectsSection = projectHeadings.length > 0

    // Count candidate project-like sections by looking for .project, .case-study, articles, or links with project keywords
    const projectCandidates = $('.project, .case-study, article').length + $('a').filter((i, el) => {
      const href = ($(el).attr('href') || '').toLowerCase()
      return /github.com|behance.net|dribbble.com|portfolio|figma.com|webflow.io|codepen.io/.test(href)
    }).length

    // Detect deployed/live links and GitHub links
    const links = $('a').map((i, el) => $(el).attr('href')).get().filter(Boolean)
    const liveLinks = links.filter(l => /http(s)?:\/\/(?!localhost|127\.0\.0\.1)/i.test(l) && !/linkedin.com/i.test(l))
    const githubLinks = links.filter(l => /github.com\//i.test(l))
    const deployedCount = liveLinks.length

    // Case study depth: look for long paragraphs near project headings or words like 'problem', 'research', 'process', 'solution'
    const caseStudyKeywords = /problem|research|user research|process|solution|wireframe|iteration|case study/i
    let caseStudyDepth = 0
    projectHeadings.each((i, el) => {
      const snippet = $(el).next('p, div, section').text() || ''
      if (caseStudyKeywords.test(snippet)) caseStudyDepth++
    })

    // Visual assets and images
    const imgCount = $('img').length
    const usesHighQualityImages = imgCount >= 3

    // Tools found on page
    const toolsList = ['figma', 'adobe', 'photoshop', 'illustrator', 'framer', 'webflow', 'react', 'node', 'vue', 'angular', 'django', 'flask']
    const toolsFound = toolsList.filter(t => bodyText.includes(t))

    // Match tools/tech to job skills
    const jobSkills = (jobContext.skills || []).map(s => String(s).toLowerCase())
    const skillMatches = jobSkills.filter(s => bodyText.includes(s)).length

    // Role-aware scoring
    const category = (jobContext.category || '').toLowerCase()

    // Project quality score (0-100)
    let projectQualityScore = 0
    if (deployedCount >= 1) projectQualityScore += 40
    if (hasProjectsSection) projectQualityScore += 20
    projectQualityScore += Math.min(20, projectCandidates * 4)
    if (caseStudyDepth >= 1) projectQualityScore += 20
    if (usesHighQualityImages) projectQualityScore = Math.min(100, projectQualityScore + 10)

    // Tool relevance (0-100)
    let toolRelevanceScore = Math.min(100, toolsFound.length * 20 + Math.min(20, skillMatches * 5))

    // Role fit (weighted)
    let roleFitScore = 0
    if (category.includes('design') || category.includes('creative')) {
      // design: weight visual & case studies higher
      roleFitScore = Math.round(projectQualityScore * 0.6 + toolRelevanceScore * 0.3 + Math.min(100, skillMatches * 10) * 0.1)
    } else {
      // technical / developer roles: prefer deployed projects & github
      const techSignal = Math.min(100, githubLinks.length * 20 + Math.min(50, skillMatches * 10))
      roleFitScore = Math.round(projectQualityScore * 0.4 + toolRelevanceScore * 0.2 + techSignal * 0.4)
    }

    const summaryParts = []
    if (hasProjectsSection) summaryParts.push('Has dedicated Projects/Case Studies section')
    if (deployedCount >= 1) summaryParts.push(`Found ${deployedCount} external/deployed links`)
    if (caseStudyDepth >= 1) summaryParts.push('Includes case study explanations')
    if (toolsFound.length) summaryParts.push(`Tools detected: ${toolsFound.join(', ')}`)
    if (!hasProjectsSection && projectCandidates === 0) summaryParts.push('Portfolio appears shallow or template-only')

    const summary = summaryParts.join('. ')

    const details = {
      platform: 'Portfolio',
      projectQualityScore,
      toolRelevanceScore,
      roleFitScore,
      summary,
      raw: { projectCandidates, deployedCount, caseStudyDepth, toolsFound, imgCount, hasProjectsSection },
    }

    // Provide an extraScore (0-60) for the inspection pipeline
    const extraScore = Math.min(60, Math.round(roleFitScore / 100 * 60))

    return { success: true, extraScore, details }
  } catch (err) {
    return { success: false, reason: err.message }
  }
}

// Instagram-specific evaluator (public data; best-effort)
async function inspectInstagramProfile(profileUrl, jobContext = {}) {
  try {
    const res = await axios.get(profileUrl, { timeout: DEFAULT_TIMEOUT, headers: { 'User-Agent': 'ProfileInspector/1.0 (+https://example.com)' } })
    const html = res.data || ''
    const lower = html.toLowerCase()

    // Detect blocked/private content
    const blocked = /login to continue|login required|please log in|this account is private|403 forbidden/i.test(lower)
    if (blocked) {
      return { success: true, extraScore: 0, details: { platform: 'Instagram', contentRelevanceScore: 0, creativityScore: 0, engagementScore: 0, summary: 'Profile requires login or is private; public content inaccessible.', confidence: 'low' } }
    }

    if (!cheerio) return { success: false, reason: 'HTML inspection unavailable: missing dependency cheerio' }

    const $ = cheerio.load(html)

    // Try to extract shared data JSON (best-effort)
    let posts = []
    try {
      const m = html.match(/window\._sharedData\s*=\s*(\{.+?\});/s)
      if (m && m[1]) {
        const shared = JSON.parse(m[1])
        const profile = shared.entry_data && shared.entry_data.ProfilePage && shared.entry_data.ProfilePage[0] && shared.entry_data.ProfilePage[0].graphql && shared.entry_data.ProfilePage[0].graphql.user
        if (profile && profile.edge_owner_to_timeline_media && profile.edge_owner_to_timeline_media.edges) {
          posts = profile.edge_owner_to_timeline_media.edges.map(e => e.node).slice(0, 12)
        }
      }
    } catch (e) {
      // ignore JSON parse errors
    }

    // Fallback: use meta description / body text to find keywords
    const bioText = ($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || $('body').text()).toLowerCase()
    const category = (jobContext.category || jobContext.role || '').toLowerCase()

    const keywordsDesign = ['design','ui','ux','illustration','motion','figma','prototype','brand','branding','typography','layout','color']
    const keywordsCreator = ['content','creator','video','reel','editing','vlog','story','tutorial','reel','shorts','social']
    const keywordsMarketing = ['campaign','marketing','brand','strategy','engagement','social']

    const useKeywords = category.includes('design') ? keywordsDesign : (category.includes('creator') || category.includes('marketing')) ? keywordsCreator.concat(keywordsMarketing) : keywordsDesign.concat(keywordsCreator).concat(keywordsMarketing)

    // Content relevance: check bio and captions for role-related keywords
    let contentHits = 0
    useKeywords.forEach(k => { if (bioText.includes(k)) contentHits++ })

    let captionHits = 0
    let avgLikes = 0
    let avgComments = 0
    if (posts.length) {
      let likesSum = 0, commentsSum = 0, counted = 0
      posts.forEach(p => {
        const caption = (p.edge_media_to_caption && p.edge_media_to_caption.edges && p.edge_media_to_caption.edges[0] && p.edge_media_to_caption.edges[0].node && p.edge_media_to_caption.edges[0].node.text) || ''
        useKeywords.forEach(k => { if (caption.toLowerCase().includes(k)) captionHits++ })
        if (p.edge_media_preview_like && typeof p.edge_media_preview_like.count === 'number') likesSum += p.edge_media_preview_like.count
        if (p.edge_media_to_comment && typeof p.edge_media_to_comment.count === 'number') commentsSum += p.edge_media_to_comment.count
        counted++
      })
      if (counted) {
        avgLikes = likesSum / counted
        avgComments = commentsSum / counted
      }
    }

    // contentRelevanceScore (0-10)
    let contentRelevanceScore = 0
    if (contentHits >= 3 || captionHits >= 3) contentRelevanceScore = 10
    else if (contentHits >= 1 || captionHits >= 1) contentRelevanceScore = 6
    else contentRelevanceScore = 0

    // creativityScore (0-10)
    let creativityHits = 0
    if (html.toLowerCase().includes('reel') || html.toLowerCase().includes('carousel')) creativityHits += 1
    if (bioText.includes('motion') || bioText.includes('editor')) creativityHits += 1
    if (posts.length && posts.some(p => p.is_video)) creativityHits += 2
    const creativityScore = Math.min(10, creativityHits * 3 + (captionHits > 0 ? 1 : 0))

    // engagementScore (0-4)
    let engagementScore = 0
    if (posts.length && avgLikes > 50 && avgComments > 5) engagementScore = 4
    else if (posts.length && avgLikes > 20) engagementScore = 3
    else if (posts.length && avgLikes > 5) engagementScore = 2
    else if (posts.length && avgLikes > 0) engagementScore = 1
    else engagementScore = 0

    const summaryParts = []
    if (contentRelevanceScore >= 6) summaryParts.push('Content appears relevant to the role')
    if (creativityScore >= 6) summaryParts.push('Strong creative signals (reels/carousels/video)')
    if (engagementScore >= 3) summaryParts.push('Healthy engagement on recent posts')
    if (summaryParts.length === 0) summaryParts.push('Limited or weak public creative signals')
    const summary = summaryParts.join('. ')

    const rawCombined = contentRelevanceScore * 4 + creativityScore * 4 + engagementScore * 5
    const extraScore = Math.min(60, Math.round(rawCombined))

    const details = { platform: 'Instagram', contentRelevanceScore, creativityScore, engagementScore, avgLikes, avgComments, postsCount: posts.length, summary }
    return { success: true, extraScore, details }
  } catch (err) {
    return { success: false, reason: err.message }
  }
}

async function inspectProfileUrl(profileUrl, jobContext = {}) {
  // Respect env flag
  if (!process.env.ENABLE_REMOTE_PROFILE_INSPECTION || process.env.ENABLE_REMOTE_PROFILE_INSPECTION === 'false') {
    return { success: false, reason: 'Remote inspection disabled by config' }
  }

  const platform = detectPlatform(profileUrl)
  try {
    if (platform === 'github') {
      return await inspectGithubProfile(profileUrl, jobContext)
    }

    // For LinkedIn, portfolio and Instagram use platform-specific evaluators where available
    if (platform === 'linkedin') {
      return await inspectLinkedInProfile(profileUrl, jobContext)
    }

    if (platform === 'portfolio') {
      return await inspectPortfolioProfile(profileUrl, jobContext)
    }

    if (platform === 'instagram') {
      return await inspectInstagramProfile(profileUrl, jobContext)
    }

    if (platform === 'website') {
      return await inspectHtmlProfile(profileUrl, jobContext)
    }

    return { success: false, reason: 'Unsupported platform' }
  } catch (err) {
    return { success: false, reason: err.message }
  }
}

module.exports = {
  detectPlatform,
  inspectProfileUrl,
  inspectGithubProfile,
  inspectLinkedInProfile,
  inspectPortfolioProfile,
  inspectInstagramProfile,
}
