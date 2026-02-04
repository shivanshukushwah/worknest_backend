const User = require("../models/User")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcrypt")
const crypto = require("crypto")
const smsService = require("../services/smsService")
const { validateSignup, validateLogin, validateForgotPassword, validateResetPassword } = require("../validators/authValidator")

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET missing in environment")
}

// Ensure JWT secret is trimmed and unquoted to avoid mismatches between sign/verify
const JWT_SECRET = process.env.JWT_SECRET ? process.env.JWT_SECRET.trim().replace(/^\"|\"$/g, "") : undefined

// Helper: Generate numeric OTP
const generateNumericOtp = (digits = 6) => {
  return Math.floor(Math.random() * Math.pow(10, digits)).toString().padStart(digits, '0')
}

// ================= REGISTER =================
exports.register = async (req, res) => {
  try {
    // Validate input via Joi
    const { error } = validateSignup(req.body)
    if (error) {
      return res.status(400).json({ message: error.details[0].message })
    }

    const { name, email, password, confirmPassword, role, phone, location, businessName, businessType, businessLocation, businessCity } = req.body

    // Verify passwords match (additional safeguard, though Joi should catch this)
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" })
    }

    const existingEmail = await User.findOne({ email })
    if (existingEmail) {
      return res.status(409).json({ message: "Email already registered" })
    }

    const existingPhone = await User.findOne({ phone })
    if (existingPhone) {
      return res.status(409).json({ message: "Phone number already registered" })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user but do not issue token until phone verified
    const userData = {
      name,
      email,
      password: hashedPassword,
      role,
      phone,
      isPhoneVerified: false,
    }

    if (role === 'student' && location) {
      userData.location = {
        city: location.city,
        state: location.state,
        country: location.country,
      }
    }

    if (role === 'employer') {
      userData.businessName = businessName
      userData.businessType = businessType
      // Map legacy businessLocation/businessCity into structured businessAddress
      userData.businessAddress = {}
      if (businessLocation) userData.businessAddress.street = businessLocation
      if (businessCity) userData.businessAddress.city = businessCity
    }

    // Set initial score for new students
    if (role === 'student') {
      const { SCORE_EVENTS } = require('../utils/constants')
      userData.score = SCORE_EVENTS.NEW_STUDENT || 0
    }

    const user = await User.create(userData)

    // Generate OTP, hash and send via SMS provider
    const otp = generateNumericOtp(6)
    const otpHash = await bcrypt.hash(otp, 10)
    user.phoneOtpHash = otpHash
    // OTP valid for 5 minutes
    user.phoneOtpExpires = new Date(Date.now() + 5 * 60 * 1000)
    user.phoneOtpSentAt = new Date()
    user.phoneOtpAttempts = 0
    user.phoneOtpBlocked = false
    // Keep raw OTP only in test env for assertions
    if (process.env.NODE_ENV === 'test') user.phoneOtp = otp
    else user.phoneOtp = undefined
    await user.save()

    const sent = await smsService.sendSms(phone, `Your verification OTP is ${otp}. It will expire in 5 minutes.`)
    if (!sent) {
      return res.status(500).json({ message: 'SMS provider not configured' })
    }

    res.status(201).json({ success: true, message: "OTP sent successfully to your mobile number." })
  } catch (err) {
    console.error("Register error:", err)
    res.status(500).json({ message: "Server error" })
  }
}

// ================= LOGIN =================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    // Enforce phone verification if phone is present
    if (user.phone && !user.isPhoneVerified) {
      return res.status(403).json({ message: "Phone not verified. Please verify your phone to proceed." })
    }

    console.log("SIGN SECRET:", JWT_SECRET)

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    )

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    })
  } catch (err) {
    console.error("Login error:", err)
    res.status(500).json({ message: "Server error" })
  }
}

// Verify phone OTP and issue token
exports.verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body
    if (!phone || !otp) return res.status(400).json({ message: 'Phone and otp are required' })

    const user = await User.findOne({ phone })
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (user.phoneOtpBlocked) {
      return res.status(400).json({ message: 'Too many attempts. Try again later.' })
    }

    if (!user.phoneOtpHash || !user.phoneOtpExpires || new Date() > user.phoneOtpExpires) {
      // clear fields if expired
      user.phoneOtpHash = undefined
      user.phoneOtp = undefined
      user.phoneOtpExpires = undefined
      user.phoneOtpSentAt = undefined
      user.phoneOtpAttempts = 0
      user.phoneOtpBlocked = false
      await user.save()
      return res.status(400).json({ message: 'OTP expired. Please request a new one.' })
    }

    const match = await bcrypt.compare(otp.toString(), user.phoneOtpHash)
    if (!match) {
      user.phoneOtpAttempts = (user.phoneOtpAttempts || 0) + 1
      if (user.phoneOtpAttempts >= 5) {
        user.phoneOtpBlocked = true
        await user.save()
        return res.status(400).json({ message: 'Too many attempts. Try again later.' })
      }
      await user.save()
      const remaining = 5 - user.phoneOtpAttempts
      return res.status(400).json({ message: `Invalid OTP. ${remaining} attempts remaining.` })
    }

    // Mark verified and clear OTP
    user.isPhoneVerified = true
    user.phoneOtpHash = undefined
    user.phoneOtp = undefined
    user.phoneOtpExpires = undefined
    user.phoneOtpSentAt = undefined
    user.phoneOtpAttempts = 0
    user.phoneOtpBlocked = false
    await user.save()

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' })

    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, role: user.role } })
  } catch (err) {
    console.error('Verify OTP error:', err)
    res.status(500).json({ message: 'Server error' })
  }
}

// Resend OTP (with 60s cooldown)
exports.resendOtp = async (req, res) => {
  try {
    const { phone } = req.body
    if (!phone) return res.status(400).json({ message: 'Phone is required' })

    const user = await User.findOne({ phone })
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (user.isPhoneVerified) return res.status(400).json({ message: 'Phone already verified' })

    const now = Date.now()
    const cooldownMs = 30 * 1000 // 30 seconds cooldown
    if (user.phoneOtpSentAt && now - new Date(user.phoneOtpSentAt).getTime() < cooldownMs) {
      return res.status(429).json({ message: 'Please wait before requesting a new OTP.' })
    }

    // Generate new OTP, update timestamps
    const otp = generateNumericOtp(6)
    const otpHash = await bcrypt.hash(otp, 10)
    user.phoneOtpHash = otpHash
    user.phoneOtpExpires = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    user.phoneOtpSentAt = new Date()
    user.phoneOtpAttempts = 0
    user.phoneOtpBlocked = false
    if (process.env.NODE_ENV === 'test') user.phoneOtp = otp
    else user.phoneOtp = undefined
    await user.save()

    const sent = await smsService.sendSms(phone, `Your verification OTP is ${otp}. It will expire in 5 minutes.`)
    if (!sent) return res.status(500).json({ message: 'SMS provider not configured' })

    res.json({ success: true, message: 'OTP sent successfully to your mobile number.' })
  } catch (err) {
    console.error('Resend OTP error:', err)
    res.status(500).json({ message: 'Server error' })
  }
}

// Optional logout
exports.logout = (req, res) => {
  // Server doesn't invalidate stateless JWTs; client should discard token
  res.json({ success: true, message: "Logged out" })
}

// ================= FORGOT PASSWORD =================
exports.forgotPassword = async (req, res) => {
  try {
    const { error } = validateForgotPassword(req.body)
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    const { email } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      // Security: don't reveal if email exists
      return res.status(200).json({ success: true, message: "If an account with that email exists, password reset instructions have been sent." })
    }

    // Generate reset token (32 char hex string)
    const resetToken = crypto.randomBytes(16).toString('hex')
    const resetTokenHash = await bcrypt.hash(resetToken, 10)

    // Store hashed token with 1 hour expiry
    user.resetPasswordToken = resetTokenHash
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
    await user.save()

    // Send reset email
    const { sendPasswordResetEmail } = require('../services/emailService')
    const emailSent = await sendPasswordResetEmail(
      user.email,
      user.name,
      resetToken,
      process.env.FRONTEND_URL || 'http://localhost:3000'
    )

    if (!emailSent && process.env.NODE_ENV === 'production') {
      return res.status(500).json({ success: false, message: 'Failed to send reset email' })
    }

    res.status(200).json({ success: true, message: "If an account with that email exists, password reset instructions have been sent." })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

// ================= RESET PASSWORD =================
exports.resetPassword = async (req, res) => {
  try {
    const { error } = validateResetPassword(req.body)
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    const { token, password, confirmPassword } = req.body

    // Verify passwords match (additional safeguard)
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match" })
    }

    // Find user with valid reset token
    const users = await User.find()
    let user = null
    for (const u of users) {
      if (u.resetPasswordToken && u.resetPasswordExpires && new Date() <= u.resetPasswordExpires) {
        const match = await bcrypt.compare(token, u.resetPasswordToken)
        if (match) {
          user = u
          break
        }
      }
    }

    if (!user) {
      return res.status(400).json({ success: false, message: "Reset token is invalid or has expired" })
    }

    // Update password
    user.password = await bcrypt.hash(password, 10)
    user.resetPasswordToken = undefined
    user.resetPasswordExpires = undefined
    await user.save()

    // Send confirmation email
    const { sendPasswordChangeConfirmation } = require('../services/emailService')
    await sendPasswordChangeConfirmation(user.email, user.name)

    res.status(200).json({ success: true, message: "Password has been reset successfully. You can now login with your new password." })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}
