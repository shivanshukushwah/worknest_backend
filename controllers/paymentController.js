const crypto = require("crypto")
const bcrypt = require("bcryptjs")
const Razorpay = require("../config/razorpay")
const mongoose = require('mongoose')
const Wallet = require("../models/Wallet")
const Transaction = require("../models/Transaction")
const Job = require("../models/Job")
const User = require("../models/User")
const ResponseHelper = require("../utils/responseHelper")
const { JOB_STATUS, PAYMENT_STATUS } = require("../utils/constants")
const Notification = require("../models/Notification")
const NotificationService = require("../services/notificationService")
const Settings = require("../models/Settings")
const WalletService = require("../services/walletService")

// @desc    Create Razorpay order for deposit
// @route   POST /api/payments/create-order
// @access  Private
const createDepositOrder = async (req, res) => {
  try {
    let { amount } = req.body
    amount = Number(amount)

    if (!amount || Number.isNaN(amount) || amount < 1) {
      return ResponseHelper.error(res, "Amount must be a number and at least ₹1", 400)
    }

    // Wallet must exist before creating a deposit order
    const wallet = await Wallet.findOne({ user: req.user.id })
    if (!wallet) {
      return ResponseHelper.error(res, "Wallet not found. Please create a wallet before creating a deposit order", 400)
    }

    // Create a short unique receipt (max 40 chars) to satisfy Razorpay limits
    const receipt = `deposit_${crypto.randomBytes(6).toString('hex')}` // ~19 chars

    // Create Razorpay order
    const options = {
      amount: Math.round(amount * 100), // Convert to paise and ensure integer
      currency: "INR",
      receipt,
      notes: {
        userId: req.user.id,
        type: "wallet_deposit",
      },
    }

    console.log("createDepositOrder receipt:", receipt)
    console.log("createDepositOrder options:", options)
    console.log("Razorpay.orders.create available:", Boolean(Razorpay && Razorpay.orders && Razorpay.orders.create))

    const order = await Razorpay.orders.create(options)
    console.log("Razorpay order created:", order)
    console.log(`Deposit requested: ₹${amount} (Razorpay amount: ${order.amount} paise)`)

    // Create transaction record
    const transaction = await Transaction.create({
      user: req.user.id,
      type: "deposit",
      amount,
      status: PAYMENT_STATUS.PENDING,
      description: `Wallet deposit of ₹${amount}`,
      razorpayOrderId: order.id,
    })

    // Return only the original amount (INR) to the client
    ResponseHelper.success(
      res,
      {
        orderId: order.id,
        amount: amount, // in INR
        currency: order.currency,
        transactionId: transaction._id,
      },
      "Deposit order created successfully",
    )
  } catch (error) {
    // log full error object for debugging
    console.error("Create deposit order error:", error && (error.stack || JSON.stringify(error) || error))

    const rawMsg = (error && (error.message || error.error?.description)) || (typeof error === 'string' ? error : JSON.stringify(error))
    const message = process.env.NODE_ENV === 'production' ? "Failed to create deposit order" : `Failed to create deposit order: ${rawMsg}`

    ResponseHelper.error(res, message, 500)
  }
}

// @desc    Verify payment and add funds to wallet
// @route   POST /api/payments/verify-deposit
// @access  Private
const verifyDeposit = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, transactionId } = req.body

    // Verify signature
    const body = razorpayOrderId + "|" + razorpayPaymentId
    const expectedSignature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(body).digest("hex")

    // Debug: log values in development
    if (process.env.NODE_ENV !== 'production') {
      console.log("verifyDeposit received:", { razorpayOrderId, razorpayPaymentId, razorpaySignature })
      console.log("verifyDeposit expectedSignature:", expectedSignature)
    }

    if (expectedSignature !== razorpaySignature) {
      return ResponseHelper.error(res, "Invalid payment signature", 400)
    }

    // Validate transactionId before querying (prevent CastError)
    if (!transactionId) {
      return ResponseHelper.error(res, "transactionId is required", 400)
    }

    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
      return ResponseHelper.error(res, "Invalid transactionId", 400)
    }

    // Find transaction
    const transaction = await Transaction.findById(transactionId)
    if (!transaction) {
      return ResponseHelper.error(res, "Transaction not found", 404)
    }

    if (transaction.status !== PAYMENT_STATUS.PENDING) {
      return ResponseHelper.error(res, "Transaction already processed", 400)
    }

    // Update transaction
    transaction.razorpayPaymentId = razorpayPaymentId
    transaction.razorpaySignature = razorpaySignature
    await transaction.markCompleted()

    // Add funds to wallet - perform via WalletService to ensure atomic transaction and wallet update
    try {
      const { wallet: updatedWallet, transaction: depositTx } = await WalletService.addFunds(req.user.id, transaction.amount, { description: `Wallet deposit of ₹${transaction.amount}`, metadata: { razorpayOrderId: razorpayOrderId, razorpayPaymentId } })
      ResponseHelper.success(
        res,
        {
          transaction: depositTx,
          wallet: updatedWallet,
        },
        "Payment verified and funds added successfully",
      )
    } catch (err) {
      console.error('Error adding funds via WalletService:', err)
      return ResponseHelper.error(res, "Failed to add funds to wallet", 500)
    }
  } catch (error) {
    console.error("Verify deposit error:", error)
    ResponseHelper.error(res, "Payment verification failed", 500)
  }
}

// @desc    Process job payment (move to escrow)
// @route   POST /api/payments/job-payment/:jobId
// @access  Private (Employer only)
const processJobPayment = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId).populate("assignedStudent employer")

    console.log("processJobPayment job:", job && { id: job._id, jobType: job.jobType, assignedStudent: job.assignedStudent, employer: job.employer, status: job.status })

    if (!job) {
      return ResponseHelper.error(res, "Job not found", 404)
    }

    if (job.employer._id.toString() !== req.user.id) {
      return ResponseHelper.error(res, "Not authorized", 403)
    }

    // Allow payment when job is in progress or when it's an offline job with an assigned student
    if (job.status !== JOB_STATUS.IN_PROGRESS && !(job.jobType === 'offline' && job.assignedStudent)) {
      const debugInfo = { jobType: job.jobType, hasAssignedStudent: Boolean(job.assignedStudent) }
      return ResponseHelper.error(res, "Job is not in progress (or not eligible for offline upfront payment)", 400, debugInfo)
    }

    if (!job.assignedStudent) {
      return ResponseHelper.error(res, "No assigned student for this job", 400)
    }

    if (job.escrowAmount > 0) {
      return ResponseHelper.error(res, "Payment already processed", 400)
    }

    const paymentAmount = job.budget
    const commissionRate = Number.parseFloat(process.env.PLATFORM_COMMISSION_RATE) || 0.05
    const commissionAmount = paymentAmount * commissionRate

    // Check employer wallet balance - wallet must exist
    let employerWallet = await Wallet.findOne({ user: req.user.id })
    if (!employerWallet) {
      return ResponseHelper.error(res, "Employer wallet not found. Please create and fund wallet before making job payment", 400)
    }

    if (employerWallet.balance < paymentAmount) {
      return ResponseHelper.error(res, "Insufficient wallet balance", 400)
    }

    // Move funds to escrow using WalletService (atomic update + transaction creation)
    try {
      await WalletService.moveToEscrow(req.user.id, paymentAmount, { description: `Payment for job: ${job.title}`, jobId: job._id })

      // Update job
      job.escrowAmount = paymentAmount
      await job.save()

      // Return trimmed job summary (no full applications array)
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
        employer: job.employer || null,
      }

      ResponseHelper.success(res, { job: jobSummary }, "Job payment processed successfully")
    } catch (err) {
      console.error("Error moving funds to escrow via WalletService:", err)
      return ResponseHelper.error(res, "Payment processing failed", 500)
    }
  } catch (error) {
    console.error("Process job payment error:", error)
    ResponseHelper.error(res, "Payment processing failed", 500)
  }
}

// @desc    Release payment after job completion
// @route   POST /api/payments/release-payment/:jobId
// @access  Private (Employer only)
const releasePayment = async (req, res) => {
  try {
    const { jobId } = req.params

    // Pre-flight validation
    const job = await Job.findById(jobId).populate("assignedStudent employer")
    if (!job) return ResponseHelper.error(res, "Job not found", 404)

    console.log('releasePayment job:', {
      id: job._id && job._id.toString(),
      status: job.status,
      employerApproved: job.employerApproved,
      studentApproved: job.studentApproved,
      paymentReleased: job.paymentReleased,
      escrowAmount: job.escrowAmount,
      assignedStudent: job.assignedStudent ? job.assignedStudent._id ? job.assignedStudent._id.toString() : job.assignedStudent : null,
    })

    if (!job.employerApproved || !job.studentApproved) return ResponseHelper.error(res, "Both sides must approve completion", 400)
    if (job.paymentReleased) return ResponseHelper.error(res, "Payment already released", 400)

    const paymentAmount = job.escrowAmount || job.budget
    if (!paymentAmount || paymentAmount <= 0) return ResponseHelper.error(res, "No payment to release", 400)

    // Wallet pre-checks
    const employerWallet = await Wallet.findOne({ user: job.employer })
    console.log('releasePayment pre-check employerWallet', employerWallet && { balance: employerWallet.balance, escrowBalance: employerWallet.escrowBalance })
    if (!employerWallet) return ResponseHelper.error(res, "Employer wallet not found. Cannot release payment.", 400)
    if (employerWallet.escrowBalance < paymentAmount) return ResponseHelper.error(res, "Insufficient escrow balance", 400)

    const studentWallet = await Wallet.findOne({ user: job.assignedStudent })
    console.log('releasePayment pre-check studentWallet', studentWallet && { balance: studentWallet.balance, totalEarnings: studentWallet.totalEarnings })
    if (!studentWallet) return ResponseHelper.error(res, "Student wallet not found. Student must create a wallet to receive payout.", 400)

    // Use WalletService to release funds atomically (handles wallets and transactions inside)
    try {
      const result = await WalletService.releaseFromEscrow(job)

      // After successful commit, send notifications (best-effort, outside tx)
      try {
        await NotificationService.createAndSendNotification({
          recipientId: req.body?.studentId || job.assignedStudent,
          senderId: req.user.id,
          type: "payment_received",
          title: "Payment Released",
          message: `A payment has been released for your job.`,
          jobId: job._id,
        })

        await NotificationService.createAndSendNotification({
          recipientId: req.user.id,
          senderId: req.user.id,
          type: "payment_released",
          title: "Payment Released",
          message: `Payment has been released.`,
          jobId: job._id,
        })
      } catch (notifyErr) {
        console.error("Notify payment released error:", notifyErr)
      }

      ResponseHelper.success(res, result, "Payment released successfully")
    } catch (err) {
      console.error("Release payment error via WalletService:", err)
      if (err.message === 'Insufficient escrow balance') return ResponseHelper.error(res, "Insufficient escrow balance", 400)
      if (err.message === 'Employer wallet not found') return ResponseHelper.error(res, "Employer wallet not found. Cannot release payment.", 400)
      if (err.message === 'Student wallet not found') return ResponseHelper.error(res, "Student wallet not found. Student must create a wallet to receive payout.", 400)
      // If transaction numbers not supported, give helpful message
      if (err.name === 'MongoServerError' && err.code === 20) return ResponseHelper.error(res, "Database does not support transactions (not a replica set). Please enable a replica set for transactional releases.", 500)

      ResponseHelper.error(res, "Payment release failed", 500)
    }
  } catch (error) {
    console.error("Release payment error:", error)
    // provide safer error messages for known cases
    if (error.message === "Job not found") return ResponseHelper.error(res, "Job not found", 404)
    if (error.message === "Both sides must approve completion") return ResponseHelper.error(res, "Both sides must approve completion", 400)
    if (error.message === "Payment already released") return ResponseHelper.error(res, "Payment already released", 400)
    if (error.message === "No payment to release") return ResponseHelper.error(res, "No payment to release", 400)
    if (error.message === "Employer wallet not found. Cannot release payment.") return ResponseHelper.error(res, "Employer wallet not found. Cannot release payment.", 400)
    if (error.message === "Insufficient escrow balance") return ResponseHelper.error(res, "Insufficient escrow balance", 400)
    if (error.message === "Student wallet not found. Student must create a wallet to receive payout.") return ResponseHelper.error(res, "Student wallet not found. Student must create a wallet to receive payout.", 400)

    ResponseHelper.error(res, "Payment release failed", 500)
  }
}

// @access  Private (Admin only - for now, employer can refund)
const refundPayment = async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId).populate("student employer")

    if (!job) {
      return ResponseHelper.error(res, "Job not found", 404)
    }

    if (job.employer._id.toString() !== req.user.id) {
      return ResponseHelper.error(res, "Not authorized", 403)
    }

    if (job.status === JOB_STATUS.PAID) {
      return ResponseHelper.error(res, "Cannot refund already paid job", 400)
    }

    if (job.escrowAmount === 0) {
      return ResponseHelper.error(res, "No payment to refund", 400)
    }

    const refundAmount = job.escrowAmount

    // Get employer wallet
    const employerWallet = await Wallet.findOne({ user: job.employer._id })

    // Refund from escrow to balance
    await employerWallet.refundFromEscrow(refundAmount)

    // Update job
    job.status = JOB_STATUS.CANCELLED
    job.escrowAmount = 0
    await job.save()

    // Create refund transaction
    await Transaction.create({
      user: job.employer._id,
      type: "refund",
      amount: refundAmount,
      status: PAYMENT_STATUS.COMPLETED,
      description: `Refund for cancelled job: ${job.title}`,
      job: job._id,
      relatedUser: job.assignedStudent,
      completedAt: new Date(),
    })

    // Return trimmed job summary (no full applications array)
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
      employer: job.employer || null,
    }

    ResponseHelper.success(res, { job: jobSummary, refundAmount }, "Payment refunded successfully")
  } catch (error) {
    console.error("Refund payment error:", error)
    ResponseHelper.error(res, "Refund processing failed", 500)
  }
}

module.exports = {
  createDepositOrder,
  verifyDeposit,
  processJobPayment,
  releasePayment,
  refundPayment,
}