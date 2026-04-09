const mongoose = require("mongoose")
const Job = require("../models/Job")
const User = require("../models/User")
const Wallet = require("../models/Wallet")
const WalletService = require("../services/walletService")
const ResponseHelper = require("../utils/responseHelper")
const { validateProfileCompletion, getMissingFieldsMessage } = require("../services/profileValidation")
const { JOB_STATUS } = require("../utils/constants")

// Helper to tolerate both JWT payload shapes (id or _id)
const getUserId = (user) => user?.id || user?._id

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id))

const normalizeJob = (job) => {
  if (!job) return null

  const safeLocation = job.location && typeof job.location === 'object' ? job.location : {
    city: '',
    state: '',
    country: '',
    coordinates: { latitude: null, longitude: null },
  }

  const safeEmployer = job.employer && typeof job.employer === 'object' ? job.employer : {
    _id: null,
    name: '',
    businessName: '',
  }

  // Ensure compatibility between 'budget' and 'salary', 'jobType' and 'type'
  const normalized = {
    ...job,
    id: job.id || job._id,
    salary: job.salary || job.budget || 0,
    salaryType: job.salaryType || 'fixed',
    type: job.type || job.jobType || 'offline',
    jobType: job.jobType || job.type || 'offline',
    applications: Array.isArray(job.applications) ? job.applications : [],
    location: safeLocation,
    employer: safeEmployer,
    assignedStudents: Array.isArray(job.assignedStudents) ? job.assignedStudents : [],
    assignedStudent: job.assignedStudent || null,
    deadline: job.deadline || job.shortlistWindowEndsAt || null,
    submission: job.submission || { description: '', attachments: [], submittedAt: null },
  }

  return normalized
}

// @desc    Create a new job
// @route   POST /api/jobs
// @access  Private (Employer only)
const createJob = async (req, res) => {
  console.log("CREATE JOB body:", req.body) // debug

  try {
    const { title, description, budget, duration, category, jobType = "offline", positionsRequired = 1, applicationDeadlineHours = 3, location } = req.body

    if (!title || !description || !budget || !duration || !category) {
      return res.status(400).json({ success: false, message: "Missing required fields: title, description, budget, duration, category" })
    }

    // Offline jobs require location
    if (jobType === 'offline' && (!location || !location.city || !location.state)) {
      return res.status(400).json({ success: false, message: "Location (city, state) is required for offline jobs" })
    }

    // ensure authenticated user available
    const employerId = getUserId(req.user)
    if (!employerId) return res.status(401).json({ success: false, message: "Unauthorized" })

    // Check profile completeness before allowing job creation
    const employer = await User.findById(employerId)
    if (!employer) return res.status(404).json({ success: false, message: "User not found" })
    const profileValidation = validateProfileCompletion(employer)
    if (!profileValidation.isComplete) {
      const msg = getMissingFieldsMessage(profileValidation.missingFields)
      return res.status(400).json({ success: false, message: msg })
    }

    // coerce numeric fields and enforce sensible defaults
    const positionsRequiredNum = Math.max(1, parseInt(positionsRequired, 10) || 1)
    const applicationDeadlineHoursNum = Math.max(1, parseInt(applicationDeadlineHours, 10) || 3)

    // If online job, ensure the employer selected at least 1 hour for application deadline
    if (String(jobType) === 'online' && applicationDeadlineHoursNum < 1) {
      return res.status(400).json({ success: false, message: 'applicationDeadlineHours must be at least 1 hour for online jobs' })
    }

    // Salary should be locked in escrow at posting
    const budgetNum = Number(budget)
    if (Number.isNaN(budgetNum) || budgetNum <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid budget amount' })
    }

    const employerWallet = await Wallet.findOne({ user: employerId })
    if (!employerWallet) {
      return res.status(400).json({ success: false, message: 'Employer wallet not found. Please create and load wallet first.' })
    }

    if (employerWallet.balance < budgetNum) {
      return res.status(400).json({ success: false, message: `Insufficient wallet balance. Please add ₹${(budgetNum - employerWallet.balance).toFixed(2)} more.` })
    }

    const jobData = {
      title,
      description,
      category,
      budget: budgetNum,
      duration: String(duration).trim(),
      employer: new mongoose.Types.ObjectId(employerId),
      postedBy: new mongoose.Types.ObjectId(employerId),
      jobType,
      positionsRequired: positionsRequiredNum,
      shortlistMultiplier: 3,
      shortlistWindowHours: applicationDeadlineHoursNum,
      submissionRequiresFiles: false,
      escrowAmount: budgetNum,
      status: JOB_STATUS.OPEN,
      deadline: new Date(Date.now() + applicationDeadlineHoursNum * 60 * 60 * 1000), // Set universal deadline
    }
    // Add location for offline jobs
    if (jobType === 'offline' && location) {
      jobData.location = {
        city: location.city,
        state: location.state,
        country: location.country || 'India', // default to India
      }
    }

    // Set shortlist window end time for online jobs
    if (jobType === 'online') {
      jobData.shortlistWindowEndsAt = new Date(Date.now() + applicationDeadlineHoursNum * 60 * 60 * 1000)
    }

    let job = null
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const created = await Job.create([jobData], { session })
        job = created[0]

        await WalletService.moveToEscrow(employerId, budgetNum, {
          description: `Escrow lock for job posting: ${title}`,
          jobId: job._id,
          session,
        })

        job.escrowAmount = budgetNum
        await job.save({ session })
      })
    } finally {
      session.endSession()
    }

    return res.status(201).json({ success: true, data: job })
  } catch (err) {
    console.error("Create job error:", err)
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors || {}).map(e => e.message).filter(Boolean)
      return res.status(400).json({ success: false, message: messages.join('; ') || 'Validation failed' })
    }
    return res.status(500).json({ success: false, message: "Server error" })
  }
}

// @desc    Get list of jobs (optional ?mine=true)
const getJobs = async (req, res) => {
  try {
    const { mine, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    const query = {};
    if (mine === "true" && req.user) {
      query.employer = getUserId(req.user);
    } else if (req.user && (req.user.role === 'worker' || req.user.role === 'student')) {
      // For students/workers viewing jobs:
      // 1. Only show OPEN jobs
      query.status = JOB_STATUS.OPEN;
      
      // 2. Hide jobs whose deadline has passed
      // For backward compatibility, also show jobs where deadline doesn't exist
      query.$or = [
        { deadline: { $gt: new Date() } },
        { deadline: { $exists: false } }
      ];

      const userId = getUserId(req.user);
      const student = await User.findById(userId);
      
      if (student && student.location) {
        const city = (student.location.city || "").trim();
        const state = (student.location.state || "").trim();
        
        // Match online jobs OR offline jobs in student's city/state
        // If student has no city/state set in their profile, they should see ALL open jobs
        // Match online jobs OR offline jobs in student's city/state
        // If student has no city/state set in their profile, they should see ALL open jobs
        if (city || state) {
          query.$or = [
            { jobType: 'online' },
            { 
              jobType: 'offline',
              $or: [
                ...(city ? [{ "location.city": new RegExp(city, "i") }] : []),
                ...(state ? [{ "location.state": new RegExp(state, "i") }] : [])
              ]
            }
          ];
        }
      }
    }

    const total = await Job.countDocuments(query);
    let jobs = await Job.find(query)
      .populate("employer", "name businessName avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const userId = getUserId(req.user);
    const isStudent = req.user && (req.user.role === 'worker' || req.user.role === 'student');

    jobs = jobs.map(j => {
      const jobObj = j.toObject ? j.toObject() : j;
      const normalized = normalizeJob(jobObj);
      
      // If student, attach their specific application status
      if (isStudent && userId) {
        const myApp = (jobObj.applications || []).find(a => String(a.student) === String(userId));
        if (myApp) {
          normalized.applicationStatus = myApp.status;
          normalized.applicationId = myApp._id;
        }
      }
      
      return normalized;
    });

    return res.json({
      success: true,
      data: jobs,
      pagination: {
        total,
        page: parseInt(page),
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error("Get jobs error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// @desc    Get single job by id
const getJobById = async (req, res) => {
  try {
    const { id } = req.params
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job ID" })
    }

    let job = await Job.findById(id).populate("employer", "name businessName").lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    job = normalizeJob(job)

    return res.json({ success: true, data: job });
  } catch (err) {
    console.error("Get job error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// @desc    Get shortlisted applications for a job (employer or admin only)
// @route   GET /api/jobs/:id/shortlisted
// @access  Private (Employer of job or Admin)
const getShortlistedCandidates = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })
    const { id } = req.params
    const page = parseInt(req.query.page) || 1;
    const limitNum = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limitNum;

    const job = await Job.findById(id).populate('applications.student', 'name phone avatar skillScore').lean()
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    if (req.user.role !== 'admin' && String(job.employer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden" })
    }

    const shortlisted = (job.applications || []).filter(a => a.shortlisted);
    const total = shortlisted.length;
    const paginatedShortlist = shortlisted.slice(skip, skip + limitNum).map(a => ({
      id: a._id,
      jobId: id,
      studentId: a.student ? a.student._id : null,
      status: a.status,
      appliedAt: a.createdAt,
      coverLetter: a.coverLetter || '',
      evaluationScore: a.evaluationScore || 0,
      student: {
        id: a.student ? a.student._id : null,
        name: a.student ? a.student.name : 'Unknown',
        phone: a.student ? a.student.phone : null,
        avatar: a.student ? a.student.avatar : null,
        skillScore: a.student ? a.student.skillScore : 0
      }
    }));

    return res.json({ 
      success: true, 
      data: paginatedShortlist,
      pagination: {
        total,
        page,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (err) {
    console.error('Get shortlisted candidates error:', err)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// @desc    Get jobs posted by current employer
const getMyJobs = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);
    
    const employerId = new mongoose.Types.ObjectId(getUserId(req.user));
    const total = await Job.countDocuments({ employer: employerId });
    let jobs = await Job.find({ employer: employerId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    jobs = jobs.map(normalizeJob)
      
    return res.json({
      success: true,
      data: jobs,
      pagination: {
        total,
        page: parseInt(page),
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error("Get my jobs error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

// @desc    Get submission for a job (employer, assigned student, or admin)
// @route   GET /api/jobs/:id/submission
// @access  Private (Employer, Assigned Student, or Admin)
const getJobSubmission = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })
    const { id } = req.params
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job ID" })
    }
    const job = await Job.findById(id).lean()
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    // Only employer, admin, or the assigned student(s) can view the submission
    const isEmployer = String(job.employer) === String(req.user.id)
    const isAdmin = req.user.role === 'admin'
    const isAssignedStudent = (job.assignedStudent && String(job.assignedStudent) === String(req.user.id)) || (Array.isArray(job.assignedStudents) && job.assignedStudents.map(String).includes(String(req.user.id)))

    if (!isEmployer && !isAdmin && !isAssignedStudent) {
      return res.status(403).json({ success: false, message: 'Forbidden: not allowed to view submission' })
    }

    const submission = job.submission || null

    const jobSummary = {
      _id: job._id,
      title: job.title,
      assignedStudents: job.assignedStudents || [],
      assignedStudent: job.assignedStudent || null,
      status: job.status,
      submissionAvailable: Boolean(submission && (submission.submittedAt || (submission.attachments && submission.attachments.length) || (submission.description && String(submission.description).trim().length > 0)))
    }

    return res.json({ success: true, submission, job: jobSummary })
  } catch (err) {
    console.error('Get job submission error:', err)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// The following endpoints depend on your Job schema (applications workflow).
// Provide lightweight stubs so routes don't crash — implement full logic as needed.

const applyForJob = async (req, res) => {
  console.log("Auth header:", req.header("authorization"))
  console.log("REQ.user:", req.user)
  console.log("APPLY body:", req.body)

  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })

    // Check profile completeness before allowing job application
    const student = await User.findById(req.user.id)
    if (!student) return res.status(404).json({ success: false, message: "User not found" })
    const profileValidation = validateProfileCompletion(student)
    if (!profileValidation.isComplete) {
      const msg = getMissingFieldsMessage(profileValidation.missingFields)
      return res.status(400).json({ success: false, message: msg })
    }

    const job = await Job.findById(req.params.id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    // Initialize applications array if missing (for old documents)
    if (!job.applications) {
      job.applications = []
    }

    // prevent duplicate applications
    const already = job.applications.find(a => String(a.student) === String(req.user.id))
    if (already) {
      return res.status(200).json({ success: true, application: already, message: "Already applied" })
    }

    if (job.jobType === 'offline') {
      // Offline: first-come-first-serve up to 3× positionsRequired
      const maxApplications = (job.positionsRequired || 1) * 3
      if ((job.applications || []).length >= maxApplications) {
        // close job for new applications
        job.status = require('../utils/constants').JOB_STATUS.CLOSED
        await job.save()
        return res.status(400).json({ success: false, message: 'Applications closed for this offline job' })
      }

      const application = {
        student: req.user.id,
        coverLetter: req.body.coverLetter || "",
        proposedBudget: req.body.proposedBudget || null,
        createdAt: new Date(),
      }

      job.applications.push(application)
      await job.save()

      const savedApp = job.applications[job.applications.length - 1]
      return res.status(201).json({ success: true, application: savedApp })
    }

    // Online job logic
    if (job.jobType === 'online') {
      const { profileUrl, coverLetter, proposedBudget } = req.body
      if (!profileUrl) return res.status(400).json({ success: false, message: 'Profile URL (LinkedIn or portfolio) is required for this job' })

      // Check if application limit reached (10 × positionsRequired)
      const maxApplications = (job.positionsRequired || 1) * 10
      if ((job.applications || []).length >= maxApplications) {
        job.status = require('../utils/constants').JOB_STATUS.CLOSED
        await job.save()
        return res.status(400).json({ success: false, message: 'Applications closed for this online job' })
      }

      const { evaluateProfileUrl } = require('../services/profileEvaluator')
      const result = evaluateProfileUrl(profileUrl)

      const application = {
        student: req.user.id,
        coverLetter: coverLetter || "",
        proposedBudget: proposedBudget || null,
        profileUrl,
        evaluationScore: result.score || 0,
        createdAt: new Date(),
      }

      job.applications.push(application)

      // Ensure shortlisting window is set (start when first application arrives)
      if (!job.shortlistWindowEndsAt && !job.shortlistComputed) {
        const hours = job.shortlistWindowHours || 3
        job.shortlistWindowEndsAt = new Date(Date.now() + hours * 60 * 60 * 1000)
      }

      await job.save()

      const savedApp = job.applications.find(a => String(a.student) === String(req.user.id))

      // Enqueue remote profile inspection if enabled and profileUrl present
      try {
        if (savedApp.profileUrl && process.env.ENABLE_REMOTE_PROFILE_INSPECTION === 'true') {
          const { enqueue } = require('../services/inspectionQueue')
          enqueue({ jobId: job._id, applicationId: savedApp._id, profileUrl: savedApp.profileUrl })
        }
      } catch (e) {
        console.error('Failed to enqueue inspection:', e)
      }

      // If shortlisting not yet run, inform applicant that their application is received and will be considered at window close
      if (!job.shortlistComputed) {
        return res.status(201).json({ success: true, application: savedApp, message: `Application received. Shortlisting will occur at ${job.shortlistWindowEndsAt.toISOString()}.` })
      }

      // If shortlisting already computed, return current shortlist status
      if (!savedApp.shortlisted) {
        return res.status(201).json({ success: true, application: savedApp, message: 'Application received. Not shortlisted.' })
      }

      return res.status(201).json({ success: true, application: savedApp, message: 'Application received and shortlisted' })
    }

    // Fallback
    return res.status(400).json({ success: false, message: 'Invalid job configuration' })
  } catch (err) {
    console.error("Apply error:", err)
    return res.status(500).json({ success: false, message: "Server error" })
  }
}

const NotificationService = require("../services/notificationService")

const acceptApplication = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })

    const { id, applicationId } = req.params
    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    // Initialize applications array if missing (for old documents)
    if (!job.applications) {
      job.applications = []
    }

    // only the employer who posted the job can accept an application
    if (String(job.employer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden: only employer can accept applications" })
    }

    // find application as subdocument
    const application = job.applications.id(applicationId)
    if (!application) return res.status(404).json({ success: false, message: "Application not found" })

    // if this application already accepted
    if (application.status === "accepted") {
      return res.status(200).json({ success: true, application, message: "Already accepted" })
    }

    // If job is online, ensure only shortlisted applications can be accepted
    if (job.jobType === 'online' && !application.shortlisted) {
      return res.status(400).json({ success: false, message: 'Cannot accept an application that is not shortlisted' })
    }

    // Count how many accepted applications already exist
    const acceptedCount = job.applications.filter((a) => a.status === "accepted").length
    if (acceptedCount >= (job.positionsRequired || 1)) {
      return res.status(400).json({ success: false, message: "Required number of applicants already accepted" })
    }

    // mark chosen application accepted
    job.applications.forEach((a) => {
      if (String(a._id) === String(applicationId)) {
        a.status = "accepted"
      }
    })

    // Track assigned students for multi-hire scenarios
    job.assignedStudents = job.assignedStudents || []
    // Avoid duplicates
    if (!job.assignedStudents.map(String).includes(String(application.student))) {
      job.assignedStudents.push(application.student)
    }

    // Update accepted count and job status
    job.acceptedCount = job.assignedStudents.length
    if (job.acceptedCount >= (job.positionsRequired || 1)) {
      job.status = JOB_STATUS.CLOSED
    } else {
      job.status = JOB_STATUS.IN_PROGRESS
    }

    // For backward compatibility, set single assignedStudent if not set
    if (!job.assignedStudent) job.assignedStudent = application.student

    // reset approval flags (global)
    job.studentAccepted = false
    job.studentApproved = false
    job.employerApproved = false

    await job.save()

    // send notification to accepted student (best-effort)
    try {
      await NotificationService.notifyJobAccepted(job._id, application.student, req.user.id)
    } catch (notifyErr) {
      console.error("Notify job accepted error:", notifyErr)
    }

    // Return only the accepted application and a trimmed job summary (no full applications array)
    const jobSummary = {
      _id: job._id,
      title: job.title,
      assignedStudents: job.assignedStudents || [],
      assignedStudent: job.assignedStudent || null,
      acceptedCount: job.acceptedCount,
      positionsRequired: job.positionsRequired || 1,
      status: job.status,
      escrowAmount: job.escrowAmount || 0,
      paymentReleased: job.paymentReleased || false,
      shortlistedAt: job.shortlistedAt || null,
      submission: job.submission || {}
    }

    return res.json({ success: true, application, job: jobSummary })
  } catch (err) {
    console.error("Accept application error:", err)
    return res.status(500).json({ success: false, message: "Server error" })
  }
}

// Employer rejects a specific application
const rejectApplication = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })

    const { id, applicationId } = req.params
    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    // Initialize applications array if missing (for old documents)
    if (!job.applications) {
      job.applications = []
    }

    // only employer who posted the job can reject
    if (String(job.employer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden: only employer can reject applications" })
    }

    const application = job.applications.id(applicationId)
    if (!application) return res.status(404).json({ success: false, message: "Application not found" })

    if (application.status === 'rejected') return res.status(200).json({ success: true, message: 'Already rejected' })

    application.status = 'rejected'
    await job.save()

    // Note: No score penalty for rejected applications (policy change)
    return res.json({ success: true, application })
  } catch (err) {
    console.error('Reject application error:', err)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// Employer marks a student as no-show/fake apply (strong penalty)
const penalizeNoShow = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })

    const { id, studentId } = req.params
    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    if (String(job.employer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden: only employer can penalize" })
    }

    // Apply heavy penalty to student
    try {
      const { adjustScore } = require('../services/scoreService')
      const { SCORE_EVENTS } = require('../utils/constants')
      await adjustScore(studentId, SCORE_EVENTS.NO_SHOW_FAKE_APPLY, 'no_show_fake_apply', { jobId: job._id })
    } catch (err) {
      console.error('Error penalizing student for no-show:', err)
    }

    return res.json({ success: true, message: 'Student penalized' })
  } catch (err) {
    console.error('Penalize error:', err)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// Force inspection of a specific application (employer or admin)
const forceInspectApplication = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })

    const { id, applicationId } = req.params
    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    // Initialize applications array if missing (for old documents)
    if (!job.applications) {
      job.applications = []
    }

    // only employer who posted the job or admin can force inspect
    if (String(job.employer) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: "Forbidden: only employer or admin can inspect" })
    }

    const application = job.applications.id(applicationId)
    if (!application) return res.status(404).json({ success: false, message: "Application not found" })

    if (!application.profileUrl) return res.status(400).json({ success: false, message: "No profile URL to inspect" })

    const ProfileInspector = require('../services/profileInspector')
    const result = await ProfileInspector.inspectProfileUrl(application.profileUrl, { skills: job.skillsRequired || [], category: job.category })

    if (result.success) {
      const combined = Math.min(100, (application.evaluationScore || 0) + (result.extraScore || 0))
      application.evaluationScore = combined
      application.inspection = application.inspection || {}
      application.inspection.status = 'done'
      application.inspection.result = result.details || {}
      application.inspection.inspectedAt = new Date()
    } else {
      application.inspection = application.inspection || {}
      application.inspection.status = 'failed'
      application.inspection.error = result.reason || 'inspection_failed'
      application.inspection.inspectedAt = new Date()
    }

    await job.save()

    return res.json({ success: true, application })
  } catch (err) {
    console.error('Force inspect error:', err)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

const submitWork = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })

    const { id } = req.params
    const { description = "", attachments = [] } = req.body || {}

    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    // Only assigned student can submit work
    if (!job.assignedStudent || String(job.assignedStudent) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Only assigned student can submit work" })
    }

    // ensure student accepted assignment
    if (!job.studentAccepted) {
      return res.status(400).json({ success: false, message: "You must accept the assignment before submitting work" })
    }

    // ensure job is in progress or has been closed after acceptance (closed == positions filled but still ongoing)
    if (![JOB_STATUS.IN_PROGRESS, JOB_STATUS.CLOSED].includes(job.status)) {
      return res.status(400).json({ success: false, message: "Job is not in progress" })
    }

    // if employer required files, ensure attachments present
    if (job.submissionRequiresFiles && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ success: false, message: "Attachments are required for this job" })
    }

    // For online jobs, enforce that submission meets job requirements:
    // - Require a non-empty description or at least one attachment
    // - If submissionRequiresFiles is true, attachments are mandatory (checked above)
    if (job.jobType === 'online') {
      if ((!description || String(description).trim() === '') && (!attachments || attachments.length === 0)) {
        return res.status(400).json({ success: false, message: "For online jobs, submission must include a description or attachments as per job requirements." })
      }
    } else {
      // For offline jobs, apply the general non-empty submission rule as a safety
      if ((!description || String(description).trim() === '') && (!attachments || attachments.length === 0)) {
        return res.status(400).json({ success: false, message: "Submission cannot be empty. Provide a description or attachments." })
      }
    }

    // set submission payload
    job.submission = {
      description,
      attachments,
      submittedAt: new Date(),
    }

    // mark student-approved (student marks work as finished)
    job.studentApproved = true

    await job.save()

    // Award on-time submission score if applicable
    try {
      const { adjustScore } = require('../services/scoreService')
      const { SCORE_EVENTS } = require('../utils/constants')
      // Simple heuristic: if job.duration is numeric (days), check submitted within that many days from creation
      let awarded = false
      const dur = parseInt(job.duration, 10)
      if (!isNaN(dur)) {
        const deadline = new Date(job.createdAt)
        deadline.setDate(deadline.getDate() + dur)
        if (job.submission.submittedAt <= deadline) {
          await adjustScore(job.assignedStudent || req.user.id, SCORE_EVENTS.ON_TIME_SUBMISSION, 'on_time_submission', { jobId: job._id })
          awarded = true
        }
      } else {
        // if duration not numeric, award conservatively
        await adjustScore(job.assignedStudent || req.user.id, SCORE_EVENTS.ON_TIME_SUBMISSION, 'on_time_submission', { jobId: job._id })
        awarded = true
      }
      if (awarded) console.log('On-time submission score awarded')
    } catch (err) {
      console.error('Error awarding on-time submission score:', err)
    }

    // notify employer that work is submitted (best-effort)
    try {
      await NotificationService.notifyJobCompleted(job._id, req.user.id, job.employer)
    } catch (notifyErr) {
      console.error("Notify job completed error:", notifyErr)
    }

    // Return submission and a trimmed job summary (no full applications array)
    const jobSummary = {
      _id: job._id,
      title: job.title,
      assignedStudents: job.assignedStudents || [],
      assignedStudent: job.assignedStudent || null,
      acceptedCount: job.acceptedCount || 0,
      positionsRequired: job.positionsRequired || 1,
      status: job.status,
      escrowAmount: job.escrowAmount || 0,
      paymentReleased: job.paymentReleased || false,
      shortlistedAt: job.shortlistedAt || null,
      submission: job.submission || {},
      studentAccepted: job.studentAccepted || false,
      studentApproved: job.studentApproved || false,
      employerApproved: job.employerApproved || false
    }

    return res.json({ success: true, submission: job.submission, job: jobSummary })
  } catch (err) {
    console.error("Submit work error:", err)
    return res.status(500).json({ success: false, message: "Server error" })
  }
}

const acceptAssignment = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })

    const { id } = req.params
    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    // Allow acceptance if the student is one of assignedStudents (support multi-hire)
    if (!job.assignedStudents || !job.assignedStudents.map(String).includes(String(req.user.id))) {
      return res.status(403).json({ success: false, message: "Only an assigned student can accept the assignment" })
    }

    if (job.studentAccepted) {
      return res.status(200).json({ success: true, message: "Assignment already accepted" })
    }

    job.studentAccepted = true
    job.status = JOB_STATUS.IN_PROGRESS
    await job.save()

    // notify employer about acceptance
    try {
      await NotificationService.createAndSendNotification({
        recipientId: job.employer,
        senderId: req.user.id,
        type: "application_received",
        title: "Assignment Accepted",
        message: `${req.user.name || 'A student'} accepted the assignment for \"${job.title}\".`,
        jobId: job._id,
      })
    } catch (notifyErr) {
      console.error("Notify employer assignment acceptance error:", notifyErr)
    }

    // Return a trimmed job summary (no full applications array)
    const jobSummary = {
      _id: job._id,
      title: job.title,
      assignedStudents: job.assignedStudents || [],
      assignedStudent: job.assignedStudent || null,
      acceptedCount: job.acceptedCount || 0,
      positionsRequired: job.positionsRequired || 1,
      status: job.status,
      escrowAmount: job.escrowAmount || 0,
      paymentReleased: job.paymentReleased || false,
      shortlistedAt: job.shortlistedAt || null,
      submission: job.submission || {},
      studentAccepted: job.studentAccepted || false,
      studentApproved: job.studentApproved || false,
      employerApproved: job.employerApproved || false
    }

    return res.json({ success: true, job: jobSummary })
  } catch (err) {
    console.error("Accept assignment error:", err)
    return res.status(500).json({ success: false, message: "Server error" })
  }
}

const approveCompletion = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })

    const { id } = req.params
    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    // only employer can approve completion
    if (String(job.employer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden: only employer can approve completion" })
    }

    // require student has submitted work
    if (!job.studentApproved) {
      return res.status(400).json({ success: false, message: "Student has not submitted work yet" })
    }

    job.employerApproved = true

    await job.save()

    // Award job completed score to student
    try {
      const { adjustScore } = require('../services/scoreService')
      const { SCORE_EVENTS } = require('../utils/constants')
      if (job.assignedStudent) {
        await adjustScore(job.assignedStudent, SCORE_EVENTS.JOB_COMPLETED, 'job_completed', { jobId: job._id })
        console.log('Job completed score awarded')
      }
    } catch (err) {
      console.error('Error awarding job completed score:', err)
    }

    // Optionally notify student that employer approved and they can expect payout
    let releaseResult = null
    if (job.studentApproved && !job.paymentReleased && (job.escrowAmount || job.budget) > 0) {
      try {
        releaseResult = await WalletService.releaseFromEscrow(job)
      } catch (releaseErr) {
        console.error("Auto-release after employer approval failed:", releaseErr)
        return res.status(500).json({ success: false, message: "Work approved but payout release failed", error: releaseErr.message })
      }
    }

    try {
      await NotificationService.createAndSendNotification({
        recipientId: job.assignedStudent,
        senderId: req.user.id,
        type: "job_approved",
        title: "Work Approved",
        message: `Your submitted work for \"${job.title}\" has been approved by the employer.`,
        jobId: job._id,
      })
    } catch (notifyErr) {
      console.error("Notify employer approval error:", notifyErr)
    }

    // Return the submission and a trimmed job summary (no full applications array)
    const jobSummary = {
      _id: job._id,
      title: job.title,
      assignedStudents: job.assignedStudents || [],
      assignedStudent: job.assignedStudent || null,
      acceptedCount: job.acceptedCount || 0,
      positionsRequired: job.positionsRequired || 1,
      status: job.status,
      escrowAmount: job.escrowAmount || 0,
      paymentReleased: job.paymentReleased || false,
      shortlistedAt: job.shortlistedAt || null,
      submission: job.submission || {},
      studentAccepted: job.studentAccepted || false,
      studentApproved: job.studentApproved || false,
      employerApproved: job.employerApproved || false
    }

    console.log('approveCompletion: returning trimmed job summary for job', String(job._id))
    const response = { success: true, submission: job.submission || null, job: jobSummary, debug: 'TRIMMED_APPROVE' }
    if (releaseResult) response.releaseResult = releaseResult
    return res.json(response)
  } catch (err) {
    console.error("Approve completion error:", err)
    return res.status(500).json({ success: false, message: "Server error" })
  }
}

// @desc    Close a job (stop new applications)
// @route   POST /api/jobs/:id/close
// @access  Private (Employer of job)
const closeJob = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })
    const { id } = req.params

    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    if (String(job.employer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden" })
    }

    job.status = JOB_STATUS.CLOSED
    job.closedAt = new Date()
    await job.save()

    return res.json({ success: true, data: job })
  } catch (err) {
    console.error('Close job error:', err)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// @desc    Cancel a job
// @route   PUT /api/jobs/:id/cancel
// @access  Private (Employer of job)
const cancelJob = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })
    const { id } = req.params
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid job ID" })
    }

    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    if (String(job.employer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden" })
    }

    if (job.escrowAmount > 0 && !job.paymentReleased) {
      try {
        await WalletService.refundFromEscrow(job.employer, job.escrowAmount, {
          description: `Refund for cancelled job: ${job.title}`,
          jobId: job._id,
        })
        job.escrowAmount = 0
      } catch (refundErr) {
        console.error('Refund on job cancel failed:', refundErr)
        return res.status(500).json({ success: false, message: 'Job cancel failed: refund to employer could not be completed.' })
      }
    }

    job.status = JOB_STATUS.CANCELLED
    await job.save()

    return res.json({ success: true, data: job })
  } catch (err) {
    console.error('Cancel job error:', err)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// @desc    Get all applications by current student
// @route   GET /api/jobs/my-applications
// @access  Private (Student only)
const getMyApplications = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })
    if (req.user.role !== 'worker' && req.user.role !== 'student') return res.status(403).json({ success: false, message: "Only workers can view their applications" })

    // Find all jobs where this student has applied
    const jobs = await Job.find({ "applications.student": req.user.id }).populate('employer', 'name businessName').lean()

    // Extract application details for each job
    const myApplications = jobs.map(job => {
      job = normalizeJob(job)
      if (!job.applications || !Array.isArray(job.applications)) return null
      const application = job.applications.find(a => String(a.student) === String(req.user.id))
      if (!application) return null

      return {
        applicationId: application._id,
        jobId: job._id,
        jobTitle: job.title,
        jobDescription: job.description,
        jobCategory: job.category,
        jobType: job.jobType || 'offline',
        budget: job.budget,
        duration: job.duration,
        location: job.location || null,
        employer: job.employer,
        coverLetter: application.coverLetter || '',
        proposedBudget: application.proposedBudget || null,
        status: application.status,
        shortlisted: application.shortlisted || false,
        evaluationScore: application.evaluationScore || 0,
        profileUrl: application.profileUrl || null,
        appliedAt: application.createdAt,
        jobStatus: job.status,
        jobCreatedAt: job.createdAt,
      }
    }).filter(a => a !== null)

    // Sort by application date (newest first)
    myApplications.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const total = myApplications.length;
    const paginatedApps = myApplications.slice((page - 1) * limit, page * limit);

    return res.json({
      success: true,
      data: paginatedApps,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Get my applications error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// Employer manually shortlists an application
const shortlistApplication = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })
    const { id, applicationId } = req.params

    const job = await Job.findById(id)
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    // Initialize applications array if missing (for old documents)
    if (!job.applications) {
      job.applications = []
    }

    if (String(job.employer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden" })
    }

    const application = job.applications.id(applicationId)
    if (!application) return res.status(404).json({ success: false, message: "Application not found" })

    application.shortlisted = true
    await job.save()

    return res.json({ success: true, application })
  } catch (err) {
    console.error('Shortlist application error:', err)
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}

// @desc    Get all applications for a specific job
// @route   GET /api/jobs/:id/applications
// @access  Private (Employer of job or Admin)
const getJobApplications = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" })
    const { id } = req.params
    const page = parseInt(req.query.page) || 1;
    const limitNum = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limitNum;

    const job = await Job.findById(id).populate('applications.student', 'name avatar skillScore phone').lean()
    if (!job) return res.status(404).json({ success: false, message: "Job not found" })

    if (req.user.role !== 'admin' && String(job.employer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden" })
    }

    const applications = job.applications || [];
    const total = applications.length;
    const paginatedApps = applications.slice(skip, skip + limitNum).map(a => ({
      id: a._id,
      jobId: id,
      studentId: a.student ? a.student._id : null,
      status: a.status,
      appliedAt: a.createdAt,
      coverLetter: a.coverLetter || '',
      profileUrl: a.profileUrl || '',
      evaluationScore: a.evaluationScore || 0,
      student: {
        id: a.student ? a.student._id : null,
        name: a.student ? a.student.name : 'Unknown',
        avatar: a.student ? a.student.avatar : null,
        skillScore: a.student ? a.student.skillScore : 0,
        phone: a.student ? a.student.phone : null
      }
    }));

    return res.json({
      success: true,
      data: paginatedApps,
      pagination: {
        total,
        page,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error('Get job applications error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

module.exports = {
  createJob,
  getJobs,
  getJobById,
  getShortlistedCandidates,
  getMyJobs,
  getMyApplications,
  getJobApplications,
  shortlistApplication,
  getJobSubmission,
  applyForJob,
  acceptApplication,
  acceptAssignment,
  submitWork,
  approveCompletion,
  rejectApplication,
  penalizeNoShow,
  forceInspectApplication,
  closeJob,
  cancelJob,
};

// EOF

