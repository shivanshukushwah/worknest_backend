const User = require('../models/User')

let intervalId

function startOtpCleanup(intervalMs = 60 * 1000) {
  // Run periodic cleanup to clear expired OTP fields so they are "automatically invalidated"
  if (intervalId) return
  intervalId = setInterval(async () => {
    try {
      const now = new Date()
      await User.updateMany(
        { phoneOtpExpires: { $lte: now } },
        {
          $unset: { phoneOtpHash: "", phoneOtp: "" },
          $set: { phoneOtpAttempts: 0, phoneOtpBlocked: false, phoneOtpExpires: null, phoneOtpSentAt: null },
        }
      )
    } catch (err) {
      console.error('OTP cleanup error:', err.message)
    }
  }, intervalMs)
}

function stopOtpCleanup() {
  if (!intervalId) return
  clearInterval(intervalId)
  intervalId = null
}

module.exports = { startOtpCleanup, stopOtpCleanup }
