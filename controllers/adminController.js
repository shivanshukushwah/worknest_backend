const User = require("../models/User")
const Job = require("../models/Job")
const Transaction = require("../models/Transaction")
const ResponseHelper = require("../utils/responseHelper")

// Get platform analytics
const getAnalytics = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments()
    const totalJobs = await Job.countDocuments()
    const totalTransactions = await Transaction.countDocuments()
    const totalRevenue = await Transaction.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ])
    ResponseHelper.success(res, {
      totalUsers,
      totalJobs,
      totalTransactions,
      totalRevenue: totalRevenue[0]?.total || 0
    }, "Analytics data")
  } catch (error) {
    ResponseHelper.error(res, "Server error", 500)
  }
}

// List all users
const listUsers = async (req, res) => {
  const users = await User.find().select("-password")
  ResponseHelper.success(res, users, "User list")
}

// List all jobs
const listJobs = async (req, res) => {
  const jobs = await Job.find()
  ResponseHelper.success(res, jobs, "Job list")
}

module.exports = { getAnalytics, listUsers, listJobs }