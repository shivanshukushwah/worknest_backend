const User = require('../models/User')

let intervalId

function startOtpCleanup(intervalMs = 60 * 1000) {
  // Run periodic cleanup to clear expired OTP fields so they are "automatically invalidated"
  if (intervalId) return
  intervalId = setInterval(async () => {
    try {
      const now = new Date()
      // delete any unverified user whose OTP window has passed.  The TTL index
      // will also remove stale docs, but explicitly deleting here ensures the
      // user can immediately re-register and prevents the cleanup job from
      // accidentally wiping the expiry field (which would disable the TTL).
      await User.deleteMany({ emailOtpExpires: { $lte: now }, isEmailVerified: false })

      // (legacy behaviour) any verified account accidentally left with a
      // stale otp-related field will have those removed for hygiene.
      await User.updateMany(
        { emailOtpExpires: { $exists: true }, isEmailVerified: true },
        {
          $unset: { emailOtpHash: "", emailOtp: "", emailOtpExpires: "", emailOtpSentAt: "" },
          $set: { emailOtpAttempts: 0, emailOtpBlocked: false },
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
