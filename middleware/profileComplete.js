// Middleware to check profile completeness

const User = require('../models/User')
const { validateProfileCompletion, getMissingFieldsMessage } = require('../services/profileValidation')

/**
 * Middleware: Check if user's profile is complete.
 * If not, return 400 error with list of missing fields.
 */
async function checkProfileComplete(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    const user = await User.findById(req.user.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    const validation = validateProfileCompletion(user)
    if (!validation.isComplete) {
      const msg = getMissingFieldsMessage(validation.missingFields)
      return res.status(400).json({ success: false, message: msg, missingFields: validation.missingFields })
    }

    // Attach validated user to request for efficiency
    req.validatedUser = user
    next()
  } catch (err) {
    console.error('Profile completeness check error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

module.exports = { checkProfileComplete }
