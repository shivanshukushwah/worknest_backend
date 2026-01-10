const Notification = require("../models/Notification")
const ResponseHelper = require("../utils/responseHelper")
const NotificationService = require("../services/notificationService")
const User = require("../models/User")

// @desc    Get user notifications
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res) => {
  try {
    // Debug logs to help diagnose auth issues
    console.log("getNotifications - req.user:", req.user)
    console.log("getNotifications - Authorization header:", req.headers && req.headers.authorization)

    const { page = 1, limit = 20, isRead, type } = req.query

    if (!req.user || !req.user.id) {
      return ResponseHelper.error(res, "Unauthorized", 401)
    }

    const query = { recipient: req.user.id }

    if (isRead !== undefined) {
      query.isRead = isRead === "true"
    }

    if (type) {
      query.type = type
    }

    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const notifications = await Notification.find(query)
      .populate("sender", "name avatar businessName")
      .populate("job", "title status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Notification.countDocuments(query)
    const unreadCount = await Notification.getUnreadCount(req.user.id)

    ResponseHelper.paginate(
      res,
      { notifications, unreadCount },
      pageNum,
      limitNum,
      total,
      "Notifications retrieved successfully",
    )
  } catch (error) {
    console.error("Get notifications error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user.id,
    })

    if (!notification) {
      return ResponseHelper.error(res, "Notification not found", 404)
    }

    if (!notification.isRead) {
      await notification.markAsRead()
    }

    ResponseHelper.success(res, notification, "Notification marked as read")
  } catch (error) {
    console.error("Mark as read error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Mark multiple notifications as read
// @route   PUT /api/notifications/mark-read
// @access  Private
const markMultipleAsRead = async (req, res) => {
  try {
    const { notificationIds } = req.body

    if (!notificationIds || !Array.isArray(notificationIds)) {
      return ResponseHelper.error(res, "Please provide an array of notification IDs", 400)
    }

    await Notification.markMultipleAsRead(notificationIds, req.user.id)

    const unreadCount = await Notification.getUnreadCount(req.user.id)

    ResponseHelper.success(res, { unreadCount }, "Notifications marked as read")
  } catch (error) {
    console.error("Mark multiple as read error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/mark-all-read
// @access  Private
const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user.id, isRead: false }, { isRead: true, readAt: new Date() })

    ResponseHelper.success(res, null, "All notifications marked as read")
  } catch (error) {
    console.error("Mark all as read error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: req.user.id,
    })

    if (!notification) {
      return ResponseHelper.error(res, "Notification not found", 404)
    }

    ResponseHelper.success(res, null, "Notification deleted successfully")
  } catch (error) {
    console.error("Delete notification error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Get notification statistics
// @route   GET /api/notifications/stats
// @access  Private
const getNotificationStats = async (req, res) => {
  try {
    const userId = req.user.id

    const stats = await Notification.aggregate([
      { $match: { recipient: userId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          unread: { $sum: { $cond: [{ $eq: ["$isRead", false] }, 1, 0] } },
          byType: {
            $push: {
              type: "$type",
              isRead: "$isRead",
            },
          },
        },
      },
    ])

    const result = {
      total: 0,
      unread: 0,
      byType: {},
    }

    if (stats.length > 0) {
      const data = stats[0]
      result.total = data.total
      result.unread = data.unread

      // Group by type
      result.byType = data.byType.reduce((acc, item) => {
        if (!acc[item.type]) {
          acc[item.type] = { total: 0, unread: 0 }
        }
        acc[item.type].total += 1
        if (!item.isRead) {
          acc[item.type].unread += 1
        }
        return acc
      }, {})
    }

    ResponseHelper.success(res, result, "Notification statistics retrieved successfully")
  } catch (error) {
    console.error("Get notification stats error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Test push notification
// @route   POST /api/notifications/test-push
// @access  Private
const testPushNotification = async (req, res) => {
  try {
    const { title = "Test Notification", message = "This is a test push notification" } = req.body

    const user = await User.findById(req.user.id).select("fcmToken")
    if (!user || !user.fcmToken) {
      return ResponseHelper.error(res, "FCM token not found. Please update your FCM token first.", 400)
    }

    const result = await NotificationService.sendPushNotification(user.fcmToken, title, message, {
      test: "true",
    })

    if (result.success) {
      ResponseHelper.success(res, { messageId: result.messageId }, "Test notification sent successfully")
    } else {
      ResponseHelper.error(res, `Failed to send notification: ${result.error}`, 500)
    }
  } catch (error) {
    console.error("Test push notification error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// Get all notifications for logged-in user
const getUserNotifications = async (req, res) => {
  console.log("req.user:", req.user) // debug
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, message: "Unauthorized" })
  }

  const userId = req.user.id
  const notifications = await Notification.find({ recipient: userId }).sort({ createdAt: -1 })
  res.json(notifications)
}

// Get unread notification count
const getUnreadCount = async (req, res) => {
  const count = await Notification.countDocuments({ recipient: req.user.id, isRead: false })
  res.json({ unreadCount: count })
}

module.exports = {
  getNotifications,
  markAsRead,
  markMultipleAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationStats,
  testPushNotification,
  getUserNotifications,
  getUnreadCount,
}
