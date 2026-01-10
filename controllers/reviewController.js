const Review = require("../models/Review")
const Job = require("../models/Job")
const User = require("../models/User")
const ResponseHelper = require("../utils/responseHelper")
const { validateReview, validateReviewResponse } = require("../validators/reviewValidator")
const { JOB_STATUS } = require("../utils/constants")

// @desc    Create a review
// @route   POST /api/reviews
// @access  Private
const createReview = async (req, res) => {
  try {
    // Validate input
    const { error } = validateReview(req.body)
    if (error) {
      return ResponseHelper.error(res, error.details[0].message, 400)
    }

    const { jobId, rating, comment, aspectRatings } = req.body

    // Find the job
    const job = await Job.findById(jobId).populate("employer assignedStudent")
    if (!job) {
      return ResponseHelper.error(res, "Job not found", 404)
    }

    // Check if job is completed or paid
    if (![JOB_STATUS.COMPLETED, JOB_STATUS.PAID].includes(job.status)) {
      return ResponseHelper.error(res, "Can only review completed jobs", 400)
    }

    // Determine reviewer and reviewee
    let reviewee
    if (req.user.id === job.employer._id.toString()) {
      // Employer reviewing student
      reviewee = job.assignedStudent._id
    } else if (req.user.id === job.assignedStudent._id.toString()) {
      // Student reviewing employer
      reviewee = job.employer._id
    } else {
      return ResponseHelper.error(res, "You are not authorized to review this job", 403)
    }

    // Check if review already exists
    const existingReview = await Review.findOne({
      job: jobId,
      reviewer: req.user.id,
    })

    if (existingReview) {
      return ResponseHelper.error(res, "You have already reviewed this job", 400)
    }

    // Create review
    const reviewData = {
      job: jobId,
      reviewer: req.user.id,
      reviewee,
      rating,
      comment,
    }

    if (aspectRatings) {
      reviewData.aspectRatings = aspectRatings
    }

    const review = await Review.create(reviewData)
    await review.populate([
      { path: "reviewer", select: "name avatar role" },
      { path: "reviewee", select: "name avatar role" },
      { path: "job", select: "title" },
    ])

    ResponseHelper.success(res, review, "Review created successfully", 201)
  } catch (error) {
    console.error("Create review error:", error)
    ResponseHelper.error(res, "Server error during review creation", 500)
  }
}

// @desc    Get reviews for a user
// @route   GET /api/reviews/user/:userId
// @access  Public
const getUserReviews = async (req, res) => {
  try {
    const { userId } = req.params
    const { page = 1, limit = 10, rating } = req.query

    // Build query
    const query = {
      reviewee: userId,
      isPublic: true,
    }

    if (rating) {
      query.rating = Number.parseInt(rating)
    }

    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const reviews = await Review.find(query)
      .populate("reviewer", "name avatar role businessName")
      .populate("job", "title category")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Review.countDocuments(query)

    // Get rating statistics
    const ratingStats = await Review.aggregate([
      { $match: { reviewee: userId, isPublic: true } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
          ratingDistribution: {
            $push: "$rating",
          },
        },
      },
    ])

    const stats = { averageRating: 0, totalReviews: 0, distribution: {} }
    if (ratingStats.length > 0) {
      const { averageRating, totalReviews, ratingDistribution } = ratingStats[0]
      stats.averageRating = Math.round(averageRating * 10) / 10
      stats.totalReviews = totalReviews

      // Calculate distribution
      stats.distribution = ratingDistribution.reduce((acc, rating) => {
        acc[rating] = (acc[rating] || 0) + 1
        return acc
      }, {})
    }

    ResponseHelper.paginate(res, { reviews, stats }, pageNum, limitNum, total, "User reviews retrieved successfully")
  } catch (error) {
    console.error("Get user reviews error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Get reviews by current user
// @route   GET /api/reviews/my-reviews
// @access  Private
const getMyReviews = async (req, res) => {
  try {
    const { type = "given", page = 1, limit = 10 } = req.query

    const query = {}
    if (type === "given") {
      query.reviewer = req.user.id
    } else if (type === "received") {
      query.reviewee = req.user.id
    } else {
      return ResponseHelper.error(res, "Invalid review type. Use 'given' or 'received'", 400)
    }

    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const reviews = await Review.find(query)
      .populate("reviewer", "name avatar role businessName")
      .populate("reviewee", "name avatar role businessName")
      .populate("job", "title category status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Review.countDocuments(query)

    ResponseHelper.paginate(res, reviews, pageNum, limitNum, total, "Your reviews retrieved successfully")
  } catch (error) {
    console.error("Get my reviews error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Get pending reviews (jobs that can be reviewed)
// @route   GET /api/reviews/pending
// @access  Private
const getPendingReviews = async (req, res) => {
  try {
    const userId = req.user.id

    // Find completed/paid jobs where user hasn't reviewed yet
    const jobs = await Job.find({
      $or: [{ employer: userId }, { assignedStudent: userId }],
      status: { $in: [JOB_STATUS.COMPLETED, JOB_STATUS.PAID] },
    })
      .populate("employer", "name avatar businessName")
      .populate("assignedStudent", "name avatar")
      .sort({ completedDate: -1 })

    // Filter out jobs that have already been reviewed by this user
    const reviewedJobIds = await Review.find({
      reviewer: userId,
    }).distinct("job")

    const pendingJobs = jobs.filter((job) => !reviewedJobIds.includes(job._id.toString()))

    // Return a trimmed view to avoid leaking unnecessary applicant data (no `applications` array)
    const trimmed = pendingJobs.map((job) => {
      return {
        submission: job.submission || {},
        _id: job._id,
        title: job.title,
        description: job.description,
        category: job.category,
        budget: job.budget,
        duration: job.duration,
        employer: job.employer || null,
        postedBy: job.postedBy || null,
        assignedStudents: job.assignedStudents || [],
        positionsRequired: job.positionsRequired || 1,
        acceptedCount: job.acceptedCount || 0,
        jobType: job.jobType,
        shortlistMultiplier: job.shortlistMultiplier,
        shortlistWindowHours: job.shortlistWindowHours,
        shortlistComputed: job.shortlistComputed || false,
        status: job.status,
        escrowAmount: job.escrowAmount || 0,
        paymentReleased: job.paymentReleased || false,
        studentAccepted: job.studentAccepted || false,
        studentApproved: job.studentApproved || false,
        employerApproved: job.employerApproved || false,
        submissionRequiresFiles: job.submissionRequiresFiles || false,
        createdAt: job.createdAt,
        shortlistedAt: job.shortlistedAt || null,
        assignedStudent: job.assignedStudent ? { _id: job.assignedStudent._id || job.assignedStudent, name: job.assignedStudent.name } : null,
        __v: job.__v,
      }
    })

    ResponseHelper.success(res, trimmed, "Pending reviews retrieved successfully")
  } catch (error) {
    console.error("Get pending reviews error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Add response to a review
// @route   PUT /api/reviews/:id/respond
// @access  Private
const respondToReview = async (req, res) => {
  try {
    // Accept `responseComment` as an alias for backward compatibility
    if (req.body && req.body.responseComment && !req.body.comment) {
      req.body.comment = req.body.responseComment
      // Remove alias to avoid Joi complaining about unknown keys
      delete req.body.responseComment
    }

    // Validate input
    const { error } = validateReviewResponse(req.body)
    if (error) {
      return ResponseHelper.error(res, error.details[0].message, 400)
    }

    const { comment } = req.body

    const review = await Review.findById(req.params.id)
    if (!review) {
      return ResponseHelper.error(res, "Review not found", 404)
    }

    // Check if user is the reviewee
    if (review.reviewee.toString() !== req.user.id) {
      return ResponseHelper.error(res, "You can only respond to reviews about you", 403)
    }

    // Check if response already exists
    if (review.response && review.response.comment) {
      return ResponseHelper.error(res, "You have already responded to this review", 400)
    }

    // Add response
    review.response = {
      comment,
      respondedAt: new Date(),
    }

    await review.save()
    await review.populate([
      { path: "reviewer", select: "name avatar role businessName" },
      { path: "reviewee", select: "name avatar role businessName" },
      { path: "job", select: "title" },
    ])

    ResponseHelper.success(res, review, "Response added successfully")
  } catch (error) {
    console.error("Respond to review error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Update review (within 24 hours)
// @route   PUT /api/reviews/:id
// @access  Private
const updateReview = async (req, res) => {
  try {
    // Validate input
    const { error } = validateReview(req.body)
    if (error) {
      return ResponseHelper.error(res, error.details[0].message, 400)
    }

    const review = await Review.findById(req.params.id)
    if (!review) {
      return ResponseHelper.error(res, "Review not found", 404)
    }

    // Check if user is the reviewer
    if (review.reviewer.toString() !== req.user.id) {
      return ResponseHelper.error(res, "You can only update your own reviews", 403)
    }

    // Check if review is within 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    if (review.createdAt < twentyFourHoursAgo) {
      return ResponseHelper.error(res, "Reviews can only be updated within 24 hours", 400)
    }

    // Update review
    const { rating, comment, aspectRatings } = req.body
    review.rating = rating
    review.comment = comment
    if (aspectRatings) {
      review.aspectRatings = aspectRatings
    }
    review.isEdited = true
    review.editedAt = new Date()

    await review.save()
    await review.populate([
      { path: "reviewer", select: "name avatar role businessName" },
      { path: "reviewee", select: "name avatar role businessName" },
      { path: "job", select: "title" },
    ])

    ResponseHelper.success(res, review, "Review updated successfully")
  } catch (error) {
    console.error("Update review error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Get review statistics
// @route   GET /api/reviews/stats/:userId
// @access  Public
const getReviewStats = async (req, res) => {
  try {
    const { userId } = req.params

    // Validate userId to avoid aggregation errors when caller passes an invalid id
    const { Types } = require('mongoose')
    if (!Types.ObjectId.isValid(userId)) {
      return ResponseHelper.error(res, "Invalid userId", 400)
    }

    const objectId = new Types.ObjectId(userId)

    // Aggregate safely: use $ifNull so missing aspectRatings fields don't break averages
    const stats = await Review.aggregate([
      { $match: { reviewee: objectId, isPublic: true } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
          avgComm: { $avg: "$aspectRatings.communication" },
          avgQuality: { $avg: "$aspectRatings.quality" },
          avgTimeliness: { $avg: "$aspectRatings.timeliness" },
          avgProfessionalism: { $avg: "$aspectRatings.professionalism" },
          ratingDistribution: { $push: "$rating" },
        },
      },
      {
        $project: {
          averageRating: 1,
          totalReviews: 1,
          averageAspectRatings: {
            communication: "$avgComm",
            quality: "$avgQuality",
            timeliness: "$avgTimeliness",
            professionalism: "$avgProfessionalism",
          },
          ratingDistribution: 1,
        },
      },
    ])

    const result = {
      averageRating: 0,
      totalReviews: 0,
      averageAspectRatings: {
        communication: 0,
        quality: 0,
        timeliness: 0,
        professionalism: 0,
      },
      distribution: {},
    }

    if (stats.length > 0) {
      const data = stats[0]

      result.averageRating = data.averageRating ? Math.round(data.averageRating * 10) / 10 : 0
      result.totalReviews = data.totalReviews || 0

      // Normalize aspect ratings (ensure numeric values)
      const aar = data.averageAspectRatings || {}
      result.averageAspectRatings = {
        communication: aar.communication ? Math.round(aar.communication * 10) / 10 : 0,
        quality: aar.quality ? Math.round(aar.quality * 10) / 10 : 0,
        timeliness: aar.timeliness ? Math.round(aar.timeliness * 10) / 10 : 0,
        professionalism: aar.professionalism ? Math.round(aar.professionalism * 10) / 10 : 0,
      }

      // Calculate distribution defensively
      const arr = Array.isArray(data.ratingDistribution) ? data.ratingDistribution.filter(r => typeof r === 'number') : []
      result.distribution = arr.reduce((acc, rating) => {
        acc[rating] = (acc[rating] || 0) + 1
        return acc
      }, {})
    }

    ResponseHelper.success(res, result, "Review statistics retrieved successfully")
  } catch (error) {
    console.error("Get review stats error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

module.exports = {
  createReview,
  getUserReviews,
  getMyReviews,
  getPendingReviews,
  respondToReview,
  updateReview,
  getReviewStats,
}
