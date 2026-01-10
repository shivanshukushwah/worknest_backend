const mongoose = require("mongoose")
const { NOTIFICATION_TYPES } = require("../utils/constants")

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      required: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    message: {
      type: String,
      required: true,
      maxlength: [300, "Message cannot exceed 300 characters"],
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Related entities
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
    },
    review: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Review",
    },

    // Notification status
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: Date,

    // Push notification status
    isPushSent: {
      type: Boolean,
      default: false,
    },
    pushSentAt: Date,
    pushError: String,

    // Scheduling
    scheduledFor: Date,
    isScheduled: {
      type: Boolean,
      default: false,
    },

    // Priority
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },

    // Action data for deep linking
    actionUrl: String,
    actionData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
)

// Indexes
notificationSchema.index({ recipient: 1, createdAt: -1 })
notificationSchema.index({ recipient: 1, isRead: 1 })
notificationSchema.index({ type: 1 })
notificationSchema.index({ scheduledFor: 1, isScheduled: 1 })

// Method to mark as read
notificationSchema.methods.markAsRead = function () {
  this.isRead = true
  this.readAt = new Date()
  return this.save()
}

// Static method to mark multiple notifications as read
notificationSchema.statics.markMultipleAsRead = function (notificationIds, userId) {
  return this.updateMany(
    {
      _id: { $in: notificationIds },
      recipient: userId,
    },
    {
      isRead: true,
      readAt: new Date(),
    },
  )
}

// Static method to get unread count
notificationSchema.statics.getUnreadCount = function (userId) {
  return this.countDocuments({
    recipient: userId,
    isRead: false,
  })
}

module.exports = mongoose.model("Notification", notificationSchema)
