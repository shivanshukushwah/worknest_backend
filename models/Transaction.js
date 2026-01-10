const mongoose = require("mongoose")
const { PAYMENT_STATUS } = require("../utils/constants")

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["deposit", "withdrawal", "payment", "refund", "commission", "earning"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, "Amount must be greater than 0"],
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    description: {
      type: String,
      required: true,
    },

    // Related entities
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
    },
    relatedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Payment gateway details
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,

    // Commission details
    commissionRate: {
      type: Number,
      default: 0,
    },
    commissionAmount: {
      type: Number,
      default: 0,
    },

    // Metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Timestamps for different states
    initiatedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: Date,
    failedAt: Date,
  },
  {
    timestamps: true,
  },
)

// Indexes
transactionSchema.index({ user: 1, createdAt: -1 })
transactionSchema.index({ job: 1 })
transactionSchema.index({ status: 1 })
transactionSchema.index({ type: 1 })

// Method to mark transaction as completed
transactionSchema.methods.markCompleted = function () {
  this.status = PAYMENT_STATUS.COMPLETED
  this.completedAt = new Date()
  return this.save()
}

// Method to mark transaction as failed
transactionSchema.methods.markFailed = function (reason) {
  this.status = PAYMENT_STATUS.FAILED
  this.failedAt = new Date()
  this.metadata.failureReason = reason
  return this.save()
}

module.exports = mongoose.model("Transaction", transactionSchema)
