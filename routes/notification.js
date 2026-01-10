const express = require("express")
const {
  getNotifications,
  markAsRead,
  markMultipleAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationStats,
  testPushNotification,
} = require("../controllers/notificationController")
const { auth } = require("../middleware/auth")

const router = express.Router()

// All routes require authentication
router.use(auth)

router.get("/", getNotifications)
router.get("/stats", getNotificationStats)
router.put("/mark-read", markMultipleAsRead)
router.put("/mark-all-read", markAllAsRead)
router.put("/:id/read", markAsRead)
router.delete("/:id", deleteNotification)

// Test route
router.post("/test-push", testPushNotification)

module.exports = router
