const User = require("../models/User")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcrypt")
const crypto = require("crypto")
const verifyService = require("../services/verifyService")
const emailService = require("../services/emailService")
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

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    
    // Send OTP via email
    const emailSent = await emailService.sendOtpEmail(email, name, otp)
    
    if (!emailSent) {
      await User.findByIdAndDelete(user._id)
      return res.status(500).json({ message: 'Failed to send OTP email' })
    }

    // Store OTP in database
    user.phoneOtp = otp
    user.phoneOtpExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    await user.save()

    res.status(201).json({ 
      success: true, 
      message: "OTP sent successfully to your email.",
      userId: user._id 
    })
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

// Verify email OTP and issue token
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' })

    const user = await User.findOne({ email })
    if (!user) return res.status(404).json({ message: 'User not found' })

    // Check if OTP exists and hasn't expired
    if (!user.phoneOtp) {
      return res.status(400).json({ message: 'No OTP found. Please request a new one.' })
    }

    if (user.phoneOtpExpires && new Date() > user.phoneOtpExpires) {
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' })
    }

    // Verify OTP
    if (user.phoneOtp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' })
    }

    // Mark phone as verified and clear OTP
    user.isPhoneVerified = true
    user.phoneOtp = null
    user.phoneOtpExpires = null
    await user.save()

    // Issue JWT token
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' })

    res.json({ 
      success: true, 
      message: 'Email verified successfully',
      token, 
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        role: user.role,
        isPhoneVerified: true
      } 
    })
  } catch (err) {
    console.error('Verify OTP error:', err)
    res.status(500).json({ message: 'Server error' })
  }
}

// Resend OTP (with cooldown)
exports.resendOtp = async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email is required' })

    const user = await User.findOne({ email })
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (user.isPhoneVerified) return res.status(400).json({ message: 'Email already verified' })

    // 60 second cooldown between OTP requests
    const now = Date.now()
    const cooldownMs = 60 * 1000
    if (user.phoneOtpSentAt && now - new Date(user.phoneOtpSentAt).getTime() < cooldownMs) {
      const secondsRemaining = Math.ceil((cooldownMs - (now - new Date(user.phoneOtpSentAt).getTime())) / 1000)
      return res.status(429).json({ message: `Please wait ${secondsRemaining} seconds before requesting a new OTP.` })
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    
    // Send OTP via email
    const emailSent = await emailService.sendOtpEmail(email, user.name, otp)
    
    if (!emailSent) {
      return res.status(500).json({ message: 'Failed to send OTP email' })
    }

    // Store OTP and track request time
    user.phoneOtp = otp
    user.phoneOtpExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    user.phoneOtpSentAt = new Date()
    await user.save()

    res.json({ 
      success: true, 
      message: 'OTP sent successfully to your email.' 
    })
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
