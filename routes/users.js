const express = require("express")
const multer = require("multer")
const {
  updateProfile,
  getUserById,
  searchUsers,
  getStudents,
  getEmployers,
  deactivateAccount,
  getUserStats,
  getProfileCompletionStatus,
} = require("../controllers/userController")
const { auth, authorize } = require("../middleware/auth")

const router = express.Router()

// Configure multer for file uploads
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true)
    } else {
      cb(new Error("Only image files are allowed"), false)
    }
  },
})

// All routes require authentication
router.use(auth)

// Profile management
router.put("/profile", upload.single("avatar"), updateProfile)
router.get("/profile/completion-status", getProfileCompletionStatus)
router.get("/stats", getUserStats)
router.delete("/deactivate", deactivateAccount)

// User discovery
router.get("/search", searchUsers)
router.get("/students", authorize("employer"), getStudents)
router.get("/employers", authorize("student"), getEmployers)

// Get specific user
router.get("/:id", getUserById)

module.exports = router
