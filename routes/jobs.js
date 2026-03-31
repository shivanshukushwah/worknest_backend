const express = require("express")
const {
  createJob,
  getJobs,
  getJobById,
  applyForJob,
  acceptApplication,
  submitWork,
  getMyJobs,
  getMyApplications,
  cancelJob,
  closeJob,
  getShortlistedCandidates,
  getJobApplications,
  shortlistApplication,
  getJobSubmission,
  rejectApplication,
  forceInspectApplication,
  penalizeNoShow,
  acceptAssignment,
  approveCompletion,
} = require("../controllers/jobController")
const { auth, authorize } = require("../middleware/auth")

const router = express.Router()

// All routes require authentication
router.use(auth)

// Job management
router.post("/", authorize("employer"), createJob)
router.get("/", getJobs)
router.get("/my-jobs", getMyJobs)
router.get("/employer/my-jobs", authorize("employer"), getMyJobs)
router.get("/my-applications", authorize("student"), getMyApplications)
router.get("/:id", getJobById)
router.post("/:id/close", authorize("employer"), closeJob)
router.delete("/:id", authorize("employer"), cancelJob)
router.get("/:id/applications", authorize("employer", "admin"), getJobApplications)

// Shortlisted candidates for a job (employer or admin)
router.get('/:id/shortlisted', authorize('employer', 'admin'), getShortlistedCandidates)

// Get submission for a job (employer, assigned student, or admin)
router.get('/:id/submission', authorize('employer', 'student', 'admin'), getJobSubmission)

// Job applications
router.post("/:id/apply", authorize("student"), applyForJob)
router.put("/:id/applications/:applicationId/accept", authorize("employer"), acceptApplication)
router.put('/:id/applications/:applicationId/reject', authorize("employer"), rejectApplication)
router.post("/:id/applications/:applicationId/shortlist", authorize("employer"), shortlistApplication)

// Force inspect an application (employer or admin)
router.post('/:id/applications/:applicationId/inspect', authorize(), forceInspectApplication)
router.post('/:id/penalize/:studentId', authorize("employer"), penalizeNoShow)

// Assignment / workflow
router.put("/:id/accept-assignment", authorize("student"), acceptAssignment)

router.put("/:id/submit-work", authorize("student"), submitWork)
router.put("/:id/approve-completion", authorize("employer"), approveCompletion)

router.put("/:id/cancel", authorize("employer"), cancelJob)

module.exports = router
