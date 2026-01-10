const User = require("../models/User")
const ResponseHelper = require("../utils/responseHelper")
const { validateProfileUpdate } = require("../validators/userValidator")
const cloudinary = require("../config/cloudinary")

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateProfile = async (req, res) => {
  try {
    // Validate input
    const { error } = validateProfileUpdate(req.body, req.user.role)
    if (error) {
      return ResponseHelper.error(res, error.details[0].message, 400)
    }

    const userId = req.user.id
    const updateData = { ...req.body }

    // Remove sensitive fields that shouldn't be updated via this route
    delete updateData.password
    delete updateData.email
    delete updateData.role
    delete updateData.isVerified
    delete updateData.isActive

    // Handle avatar upload if provided
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "job-marketplace/avatars",
          transformation: [{ width: 300, height: 300, crop: "fill" }, { quality: "auto" }],
        })
        updateData.avatar = result.secure_url
        // keep legacy field in sync
        updateData.profilePicture = result.secure_url
      } catch (uploadError) {
        console.error("Avatar upload error:", uploadError)
        return ResponseHelper.error(res, "Failed to upload avatar", 500)
      }
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true, runValidators: true })

    if (!updatedUser) {
      return ResponseHelper.error(res, "User not found", 404)
    }

    ResponseHelper.success(res, updatedUser, "Profile updated successfully")
  } catch (error) {
    console.error("Update profile error:", error)
    ResponseHelper.error(res, "Server error during profile update", 500)
  }
}

// @desc    Get user profile by ID
// @route   GET /api/users/:id
// @access  Private
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password -fcmToken")

    if (!user) {
      return ResponseHelper.error(res, "User not found", 404)
    }

    if (!user.isActive) {
      return ResponseHelper.error(res, "User account is deactivated", 404)
    }

    ResponseHelper.success(res, user, "User profile retrieved successfully")
  } catch (error) {
    console.error("Get user by ID error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Search users (for employers to find students)
// @route   GET /api/users/search
// @access  Private
const searchUsers = async (req, res) => {
  try {
    const {
      role = "student",
      skills,
      experience,
      city,
      page = 1,
      limit = 10,
      sortBy = "rating.average",
      sortOrder = "desc",
    } = req.query

    // Build search query
    const query = {
      role,
      isActive: true,
      isVerified: true,
    }

    // Add filters
    if (skills) {
      const skillsArray = skills.split(",").map((skill) => skill.trim())
      query.skills = { $in: skillsArray }
    }

    if (experience) {
      query.experience = experience
    }

    if (city) {
      query["businessAddress.city"] = new RegExp(city, "i")
    }

    // Calculate pagination
    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    // Build sort object
    const sort = {}
    sort[sortBy] = sortOrder === "desc" ? -1 : 1

    // Execute query
    const users = await User.find(query)
      .select("-password -fcmToken -resetPasswordToken -resetPasswordExpire")
      .sort(sort)
      .skip(skip)
      .limit(limitNum)

    const total = await User.countDocuments(query)

    ResponseHelper.paginate(res, users, pageNum, limitNum, total, "Users retrieved successfully")
  } catch (error) {
    console.error("Search users error:", error)
    ResponseHelper.error(res, "Server error during user search", 500)
  }
}

// @desc    Get all students with skills
// @route   GET /api/users/students
// @access  Private (Employer only)
const getStudents = async (req, res) => {
  try {
    const { skills, experience, page = 1, limit = 10, minRating = 0 } = req.query

    const query = {
      role: "student",
      isActive: true,
      "rating.average": { $gte: Number.parseFloat(minRating) },
    }

    if (skills) {
      const skillsArray = skills.split(",").map((skill) => skill.trim())
      query.skills = { $in: skillsArray }
    }

    if (experience) {
      query.experience = experience
    }

    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const students = await User.find(query)
      .select("name email avatar skills experience rating bio education lastLogin score")
      .sort({ "rating.average": -1, lastLogin: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await User.countDocuments(query)

    ResponseHelper.paginate(res, students, pageNum, limitNum, total, "Students retrieved successfully")
  } catch (error) {
    console.error("Get students error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Get all employers
// @route   GET /api/users/employers
// @access  Private (Student only)
const getEmployers = async (req, res) => {
  try {
    const { businessType, city, page = 1, limit = 10, minRating = 0 } = req.query

    const query = {
      role: "employer",
      isActive: true,
      "rating.average": { $gte: Number.parseFloat(minRating) },
    }

    if (businessType) {
      query.businessType = businessType
    }

    if (city) {
      query["businessAddress.city"] = new RegExp(city, "i")
    }

    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const employers = await User.find(query)
      .select("name email avatar businessName businessType businessAddress rating bio lastLogin score")
      .sort({ "rating.average": -1, lastLogin: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await User.countDocuments(query)

    ResponseHelper.paginate(res, employers, pageNum, limitNum, total, "Employers retrieved successfully")
  } catch (error) {
    console.error("Get employers error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Deactivate user account
// @route   DELETE /api/users/deactivate
// @access  Private
const deactivateAccount = async (req, res) => {
  try {
    const userId = req.user.id

    await User.findByIdAndUpdate(userId, {
      isActive: false,
      fcmToken: null, // Clear FCM token
    })

    ResponseHelper.success(res, null, "Account deactivated successfully")
  } catch (error) {
    console.error("Deactivate account error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Get user statistics
// @route   GET /api/users/stats
// @access  Private
const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id
    const userRole = req.user.role

    let stats = {}

    if (userRole === "student") {
      // Get student-specific stats
      const Job = require("../models/Job")

      stats = {
        totalApplications: await Job.countDocuments({ "applications.student": userId }),
        acceptedJobs: await Job.countDocuments({
          student: userId,
          status: { $in: ["in_progress", "completed", "paid"] },
        }),
        completedJobs: await Job.countDocuments({
          student: userId,
          status: { $in: ["completed", "paid"] },
        }),
        totalEarnings: 0, // Will be calculated from wallet transactions
      }
    } else if (userRole === "employer") {
      // Get employer-specific stats
      const Job = require("../models/Job")

      stats = {
        totalJobsPosted: await Job.countDocuments({ employer: userId }),
        activeJobs: await Job.countDocuments({
          employer: userId,
          status: { $in: ["open", "in_progress"] },
        }),
        completedJobs: await Job.countDocuments({
          employer: userId,
          status: { $in: ["completed", "paid"] },
        }),
        totalSpent: 0, // Will be calculated from wallet transactions
      }
    }

    ResponseHelper.success(res, stats, "User statistics retrieved successfully")
  } catch (error) {
    console.error("Get user stats error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

module.exports = {
  updateProfile,
  getUserById,
  searchUsers,
  getStudents,
  getEmployers,
  deactivateAccount,
  getUserStats,
}
