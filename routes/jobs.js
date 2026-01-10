const express = require("express")
const {
  createJob,
  getJobs,
  getJobById,
  applyForJob,
  acceptApplication,
  submitWork,
  getMyJobs,
  cancelJob,
} = require("../controllers/jobController")
const { auth, authorize } = require("../middleware/auth")

const router = express.Router()

// All routes require authentication
router.use(auth)

// Job management
router.post("/", authorize("employer"), createJob)
router.get("/", getJobs)
router.get("/my-jobs", getMyJobs)
router.get("/:id", getJobById)

// Shortlisted candidates for a job (employer or admin)
router.get('/:id/shortlisted', authorize('employer', 'admin'), async (req, res, next) => {
  const { getShortlistedCandidates } = require('../controllers/jobController')
  return getShortlistedCandidates(req, res, next)
})

// Get submission for a job (employer, assigned student, or admin)
router.get('/:id/submission', authorize('employer', 'student', 'admin'), async (req, res, next) => {
  const { getJobSubmission } = require('../controllers/jobController')
  return getJobSubmission(req, res, next)
})

// Job applications
router.post("/:id/apply", authorize("student"), applyForJob)
router.put("/:id/applications/:applicationId/accept", authorize("employer"), acceptApplication)
router.put('/:id/applications/:applicationId/reject', authorize("employer"), async (req, res, next) => {
  const { rejectApplication } = require('../controllers/jobController')
  return rejectApplication(req, res, next)
})

// Force inspect an application (employer or admin)
router.post('/:id/applications/:applicationId/inspect', authorize(), async (req, res, next) => {
  const { forceInspectApplication } = require('../controllers/jobController')
  return forceInspectApplication(req, res, next)
})
router.post('/:id/penalize/:studentId', authorize("employer"), async (req, res, next) => {
  const { penalizeNoShow } = require('../controllers/jobController')
  return penalizeNoShow(req, res, next)
})
// Assignment / workflow
router.put("/:id/accept-assignment", authorize("student"), async (req, res, next) => {
  // lightweight wrapper to call controller method - moved inline to avoid extra import
  const { acceptAssignment } = require("../controllers/jobController")
  return acceptAssignment(req, res, next)
})

router.put("/:id/submit-work", authorize("student"), submitWork)
router.put("/:id/approve-completion", authorize("employer"), async (req, res, next) => {
  // Reload controller so code changes are applied without server restart
  try { delete require.cache[require.resolve("../controllers/jobController")] } catch (e) {}
  const { approveCompletion } = require("../controllers/jobController")
  return approveCompletion(req, res, next)
})

router.put("/:id/cancel", authorize("employer"), cancelJob)

module.exports = router
