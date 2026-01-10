const express = require("express")
const {
  createReview,
  getUserReviews,
  getMyReviews,
  getPendingReviews,
  respondToReview,
  updateReview,
  getReviewStats,
} = require("../controllers/reviewController")
const { auth } = require("../middleware/auth")

const router = express.Router()

// Public routes
router.get("/user/:userId", getUserReviews)
router.get("/stats/:userId", getReviewStats)

// Protected routes
router.use(auth)

router.post("/", createReview)
router.get("/my-reviews", getMyReviews)
router.get("/pending", getPendingReviews)
router.put("/:id", updateReview)
router.put("/:id/respond", respondToReview)

module.exports = router
