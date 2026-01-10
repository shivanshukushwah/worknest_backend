const admin = require("../config/firebase")
const Notification = require("../models/Notification")
const User = require("../models/User")
const { NOTIFICATION_TYPES } = require("../utils/constants")
const nodemailer = require("nodemailer")
// Add SMS provider SDK if needed (e.g., Twilio)
// Add FCM for app push notifications if needed

class NotificationService {
  // Email notification
  static async sendEmail(to, subject, text) {
    const transporter = nodemailer.createTransport({
      service: "gmail", // or your email provider
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
    await transporter.sendMail({ from: process.env.EMAIL_USER, to, subject, text })
  }

  // SMS notification (stub)
  static async sendSMS(to, message) {
    // Integrate with SMS provider like Twilio here
    // Example: twilioClient.messages.create({ to, from, body: message })
  }

  // App push notification (stub)
  static async sendPushNotification(fcmToken, title, body, data = {}) {
    // Integrate with FCM or other push provider here
  }

  // Create and send notification
  static async createAndSendNotification({
    recipientId,
    senderId = null,
    type,
    title,
    message,
    data = {},
    jobId = null,
    transactionId = null,
    reviewId = null,
    priority = "normal",
    actionUrl = null,
    actionData = {},
  }) {
    try {
      // Create notification in database
      const notification = await Notification.create({
        recipient: recipientId,
        sender: senderId,
        type,
        title,
        message,
        data,
        job: jobId,
        transaction: transactionId,
        review: reviewId,
        priority,
        actionUrl,
        actionData,
      })

      // Get recipient's FCM token
      const recipient = await User.findById(recipientId).select("fcmToken name")
      if (!recipient) {
        throw new Error("Recipient not found")
      }

      // Send push notification if FCM token exists
      if (recipient.fcmToken) {
        const pushData = {
          notificationId: notification._id.toString(),
          type,
          ...data,
        }

        const pushResult = await this.sendPushNotification(recipient.fcmToken, title, message, pushData)

        // Update notification with push status
        notification.isPushSent = pushResult.success
        notification.pushSentAt = new Date()
        if (!pushResult.success) {
          notification.pushError = pushResult.error
        }
        await notification.save()
      }

      return notification
    } catch (error) {
      console.error("Create notification error:", error)
      throw error
    }
  }

  // Job-related notifications
  static async notifyNewJobPosted(jobId, employerId) {
    try {
      const Job = require("../models/Job")
      const job = await Job.findById(jobId).populate("employer", "name businessName")

      if (!job) return

      // Find students with matching skills (optional - can be sent to all students)
      const matchingStudents = await User.find({
        role: "student",
        isActive: true,
        fcmToken: { $exists: true, $ne: null },
        ...(job.skillsRequired.length > 0 && {
          skills: { $in: job.skillsRequired },
        }),
      }).select("_id")

      // Send notifications to matching students
      const notifications = matchingStudents.map((student) =>
        this.createAndSendNotification({
          recipientId: student._id,
          senderId: employerId,
          type: NOTIFICATION_TYPES.JOB_POSTED,
          title: "New Job Available!",
          message: `${job.employer.businessName || job.employer.name} posted a new job: ${job.title}`,
          data: {
            jobId: job._id.toString(),
            category: job.category,
            budget: job.budget,
          },
          jobId: job._id,
          actionUrl: `/jobs/${job._id}`,
          actionData: { jobId: job._id.toString() },
        }),
      )

      await Promise.all(notifications)
    } catch (error) {
      console.error("Notify new job posted error:", error)
    }
  }

  static async notifyJobAccepted(jobId, studentId, employerId) {
    try {
      const Job = require("../models/Job")
      // Populate employer for contextual info (job doesn't have top-level `student`)
      const job = await Job.findById(jobId).populate("employer", "name businessName")

      if (!job) return

      await this.createAndSendNotification({
        recipientId: studentId,
        senderId: employerId,
        type: NOTIFICATION_TYPES.JOB_ACCEPTED,
        title: "Job Application Accepted!",
        message: `Your application for "${job.title}" has been accepted. You can start working now!`,
        data: {
          jobId: job._id.toString(),
          status: job.status,
        },
        jobId: job._id,
        priority: "high",
        actionUrl: `/jobs/${job._id}`,
        actionData: { jobId: job._id.toString() },
      })
    } catch (error) {
      console.error("Notify job accepted error:", error)
    }
  }

  static async notifyJobCompleted(jobId, studentId, employerId) {
    try {
      const Job = require("../models/Job")
      const job = await Job.findById(jobId).populate("assignedStudent", "name")

      if (!job || !job.assignedStudent) return

      await this.createAndSendNotification({
        recipientId: employerId,
        senderId: studentId,
        type: NOTIFICATION_TYPES.JOB_COMPLETED,
        title: "Job Completed!",
        message: `${job.assignedStudent.name} has completed the job "${job.title}". Please review and release payment.`,
        data: {
          jobId: job._id.toString(),
          studentName: job.assignedStudent.name,
        },
        jobId: job._id,
        priority: "high",
        actionUrl: `/jobs/${job._id}`,
        actionData: { jobId: job._id.toString() },
      })
    } catch (error) {
      console.error("Notify job completed error:", error)
    }
  }

  static async notifyPaymentReleased(jobId, studentId, employerId, amount) {
    try {
      const Job = require("../models/Job")
      const job = await Job.findById(jobId)

      if (!job) return

      await this.createAndSendNotification({
        recipientId: studentId,
        senderId: employerId,
        type: NOTIFICATION_TYPES.PAYMENT_RELEASED,
        title: "Payment Released!",
        message: `You've received ₹${amount} for completing "${job.title}". Funds added to your wallet.`,
        data: {
          jobId: job._id.toString(),
          amount,
        },
        jobId: job._id,
        priority: "high",
        actionUrl: `/wallet`,
        actionData: { amount },
      })
    } catch (error) {
      console.error("Notify payment released error:", error)
    }
  }

  static async notifyReviewReceived(reviewId, revieweeId, reviewerId) {
    try {
      const Review = require("../models/Review")
      const review = await Review.findById(reviewId).populate("reviewer", "name businessName").populate("job", "title")

      if (!review) return

      const reviewerName = review.reviewer.businessName || review.reviewer.name

      await this.createAndSendNotification({
        recipientId: revieweeId,
        senderId: reviewerId,
        type: NOTIFICATION_TYPES.REVIEW_RECEIVED,
        title: "New Review Received!",
        message: `${reviewerName} left you a ${review.rating}-star review for "${review.job.title}"`,
        data: {
          reviewId: review._id.toString(),
          rating: review.rating,
          jobTitle: review.job.title,
        },
        reviewId: review._id,
        actionUrl: `/profile/reviews`,
        actionData: { reviewId: review._id.toString() },
      })
    } catch (error) {
      console.error("Notify review received error:", error)
    }
  }

  // Bulk notification sender
  static async sendBulkNotifications(notifications) {
    try {
      const results = await Promise.allSettled(
        notifications.map((notification) => this.createAndSendNotification(notification)),
      )

      const successful = results.filter((result) => result.status === "fulfilled").length
      const failed = results.filter((result) => result.status === "rejected").length

      return { successful, failed, total: notifications.length }
    } catch (error) {
      console.error("Send bulk notifications error:", error)
      throw error
    }
  }
}

module.exports = NotificationService
