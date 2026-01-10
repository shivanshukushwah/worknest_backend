const Wallet = require("../models/Wallet")
const Transaction = require("../models/Transaction")
const User = require("../models/User")
const ResponseHelper = require("../utils/responseHelper")
const mongoose = require("mongoose")
const Settings = require("../models/Settings")
const { PAYMENT_STATUS } = require("../utils/constants")
const WalletService = require("../services/walletService")

// @desc    Get wallet balance
// @route   GET /api/wallet
// @access  Private
const getWallet = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id })

    if (!wallet) {
      return ResponseHelper.error(res, "Wallet not found. Please create a wallet first using POST /api/wallet", 404)
    }

    ResponseHelper.success(res, wallet, "Wallet retrieved successfully")
  } catch (error) {
    console.error("Get wallet error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Create a new wallet for the authenticated user
// @route   POST /api/wallet
// @access  Private
const createWallet = async (req, res) => {
  try {
    // Ensure user has phone and phone is verified before creating wallet
    const user = await User.findById(req.user.id).select('phone isPhoneVerified role email')
    if (!user) {
      return ResponseHelper.error(res, "User not found", 404)
    }

    if (!user.phone) {
      return ResponseHelper.error(res, "Phone number required to create a wallet. Please add and verify your phone.", 400)
    }

    if (!user.isPhoneVerified) {
      return ResponseHelper.error(res, "Phone number not verified. Please verify your phone before creating a wallet.", 403)
    }

    const existing = await Wallet.findOne({ user: req.user.id })
    if (existing) {
      return ResponseHelper.success(res, existing, "Wallet already exists")
    }

    const wallet = await Wallet.create({ user: req.user.id })
    ResponseHelper.success(res, wallet, "Wallet created successfully", 201)
  } catch (error) {
    console.error("Create wallet error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Get transaction history
// @route   GET /api/wallet/transactions
// @access  Private
const getTransactions = async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query

    const query = { user: req.user.id }

    if (type) {
      query.type = type
    }

    if (status) {
      query.status = status
    }

    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const transactions = await Transaction.find(query)
      .populate("job", "title status")
      .populate("relatedUser", "name avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Transaction.countDocuments(query)

    ResponseHelper.paginate(res, transactions, pageNum, limitNum, total, "Transactions retrieved successfully")
  } catch (error) {
    console.error("Get transactions error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Request withdrawal to bank (creates a withdrawal transaction and debits wallet)
// @route   POST /api/wallet/withdraw
// @access  Private
const withdraw = async (req, res) => {
  try {
    const { amount, bankDetails } = req.body

    if (!amount || amount <= 0) {
      return ResponseHelper.error(res, "Invalid withdrawal amount", 400)
    }

    // Use WalletService to perform atomic withdrawal request
    const result = await WalletService.requestWithdrawal(req.user.id, Number(amount), {
      description: 'Withdrawal to bank',
      metadata: { bankDetails: bankDetails || null },
    })

    ResponseHelper.success(res, result, "Withdrawal requested successfully")
  } catch (error) {
    console.error("Withdraw error:", error)
    if (error.message === 'Insufficient balance') return ResponseHelper.error(res, 'Insufficient balance', 400)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// @desc    Get wallet statistics
// @route   GET /api/wallet/stats
// @access  Private
const getWalletStats = async (req, res) => {
  try {
    const userId = req.user.id

    // Get wallet
    const wallet = await Wallet.findOne({ user: userId })
    if (!wallet) {
      return ResponseHelper.success(
        res,
        {
          balance: 0,
          escrowBalance: 0,
          totalEarnings: 0,
          totalSpent: 0,
          monthlyStats: [],
        },
        "Wallet statistics retrieved successfully",
      )
    }

    // Get monthly transaction stats for the last 6 months
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const monthlyStats = await Transaction.aggregate([
      {
        $match: {
          user: userId,
          status: "completed",
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          totalAmount: { $sum: "$amount" },
          transactionCount: { $sum: 1 },
          earnings: {
            $sum: {
              $cond: [{ $in: ["$type", ["earning", "refund"]] }, "$amount", 0],
            },
          },
          spending: {
            $sum: {
              $cond: [{ $in: ["$type", ["payment", "withdrawal"]] }, "$amount", 0],
            },
          },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ])

    const stats = {
      balance: wallet.balance,
      escrowBalance: wallet.escrowBalance,
      totalEarnings: wallet.totalEarnings,
      totalSpent: wallet.totalSpent,
      monthlyStats,
    }

    ResponseHelper.success(res, stats, "Wallet statistics retrieved successfully")
  } catch (error) {
    console.error("Get wallet stats error:", error)
    ResponseHelper.error(res, "Server error", 500)
  }
}

// Explain wallet breakdown and compute expected balance from transactions
const explainWallet = async (req, res) => {
  try {
    console.log('explainWallet request user raw:', req.user)
    const userId = req.user.id
    console.log('explainWallet userId:', userId)

    const wallet = await Wallet.findOne({ user: userId })
    if (!wallet) return ResponseHelper.error(res, "Wallet not found", 404)

    // Aggregate completed transactions by type
    const objectId = new mongoose.Types.ObjectId(userId)

    const completed = await Transaction.aggregate([
      { $match: { user: objectId, status: "completed" } },
      { $group: { _id: "$type", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ])

    // Aggregate pending transactions
    const pending = await Transaction.aggregate([
      { $match: { user: objectId, status: "pending" } },
      { $group: { _id: "$type", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ])

    console.log('explainWallet aggregated completed:', JSON.stringify(completed), 'pending:', JSON.stringify(pending))

    const completedMap = completed.reduce((acc, cur) => {
      acc[cur._id] = cur.total
      return acc
    }, {})

    const pendingMap = pending.reduce((acc, cur) => {
      acc[cur._id] = cur.total
      return acc
    }, {})

    // Determine platform user id
    const settings = await Settings.findOne()
    const PLATFORM_USER_ID = process.env.PLATFORM_USER_ID || settings?.platformUserId

    // Credits: deposits, earnings, refunds, commission if credited to user
    const credits = (completedMap.deposit || 0) + (completedMap.earning || 0) + (completedMap.refund || 0) + ((PLATFORM_USER_ID && PLATFORM_USER_ID.toString() === userId) ? (completedMap.commission || 0) : 0)

    // Debits: withdrawals, payments, commission if paid by user
    const debits = (completedMap.withdrawal || 0) + (completedMap.payment || 0) + ((PLATFORM_USER_ID && PLATFORM_USER_ID.toString() !== userId) ? (completedMap.commission || 0) : 0)

    const computedCompletedBalance = Number((credits - debits - (wallet.escrowBalance || 0)).toFixed(2))

    const pendingDebits = (pendingMap.withdrawal || 0) + (pendingMap.payment || 0)
    const computedIncludingPending = Number((computedCompletedBalance - pendingDebits).toFixed(2))

    const discrepancyCompleted = Number((wallet.balance - computedCompletedBalance).toFixed(2))
    const discrepancyIncludingPending = Number((wallet.balance - computedIncludingPending).toFixed(2))

    console.log('explainWallet result computedCompletedBalance:', computedCompletedBalance, 'pendingDebits:', pendingDebits)
    console.log('explainWallet discrepancies -> completed:', discrepancyCompleted, 'includingPending:', discrepancyIncludingPending)

    ResponseHelper.success(
      res,
      {
        wallet,
        summary: {
          completed: completedMap,
          pending: pendingMap,
          credits,
          debits,
          pendingDebits,
          computedCompletedBalance,
          computedIncludingPending,
          discrepancyCompleted,
          discrepancyIncludingPending,
        },
      },
      "Wallet explanation generated successfully",
    )
  } catch (error) {
    console.error("Explain wallet error:", error && (error.stack || error))
    ResponseHelper.error(res, "Server error", 500)
  }
}

// Admin: create reconciliation adjustment for a user's wallet
const reconcileWallet = async (req, res) => {
  try {
    // Only admin should call this (route should protect with authorize('admin'))
    const { userId } = req.params
    const { amount, action = "debit", description = "Reconciliation adjustment" } = req.body

    if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      return ResponseHelper.error(res, "Invalid amount", 400)
    }

    if (!["debit", "credit"].includes(action)) {
      return ResponseHelper.error(res, "Invalid action, must be 'debit' or 'credit'", 400)
    }

    const wallet = await Wallet.findOne({ user: userId })
    if (!wallet) return ResponseHelper.error(res, "Wallet not found", 404)

    const amt = Number(amount)

    if (action === "debit") {
      // ensure enough balance
      if (wallet.balance < amt) return ResponseHelper.error(res, "Insufficient balance for debit", 400)
      wallet.balance = Number((wallet.balance - amt).toFixed(2))
      wallet.totalSpent = (wallet.totalSpent || 0) + amt

      // create completed withdrawal transaction as audit
      const tx = await Transaction.create({
        user: userId,
        type: "withdrawal",
        amount: amt,
        status: PAYMENT_STATUS.COMPLETED,
        description,
        completedAt: new Date(),
      })

      await wallet.save()
      return ResponseHelper.success(res, { wallet, tx }, "Wallet debited and transaction recorded")
    } else {
      // credit
      wallet.balance = Number((wallet.balance + amt).toFixed(2))
      wallet.totalEarnings = (wallet.totalEarnings || 0) + amt

      const tx = await Transaction.create({
        user: userId,
        type: "deposit",
        amount: amt,
        status: PAYMENT_STATUS.COMPLETED,
        description,
        completedAt: new Date(),
      })

      await wallet.save()
      return ResponseHelper.success(res, { wallet, tx }, "Wallet credited and transaction recorded")
    }
  } catch (error) {
    console.error("Reconcile wallet error:", error)
    ResponseHelper.error(res, "Reconciliation failed", 500)
  }
}

module.exports = {
  getWallet,
  createWallet,
  getTransactions,
  getWalletStats,
  withdraw,
  explainWallet,
  reconcileWallet,
}



