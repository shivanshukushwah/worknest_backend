const express = require("express")
const {
  createDepositOrder,
  verifyDeposit,
  processJobPayment,
  releasePayment,
  refundPayment,
} = require("../controllers/paymentController")
const { auth, authorize } = require("../middleware/auth")

const router = express.Router()

// All routes require authentication
router.use(auth)

// Deposit routes
router.post("/create-order", createDepositOrder)
router.post("/verify-deposit", verifyDeposit)

// Job payment routes
router.post("/job-payment/:jobId", authorize("employer"), processJobPayment)
router.post("/release-payment/:jobId", authorize("employer"), releasePayment)
router.post("/refund/:jobId", authorize("employer"), refundPayment)

module.exports = router
