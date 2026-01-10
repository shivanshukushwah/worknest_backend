const User = require("../models/User")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcrypt")
const { validateSignup, validateLogin } = require("../validators/authValidator")

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

    const { name, email, password, role, phone, businessName, businessType, businessLocation, businessCity } = req.body

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

    // Generate OTP and send (for now, log it - integrate with SMS provider later)
    const otp = generateNumericOtp(6)
    user.phoneOtp = otp
    user.phoneOtpExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    await user.save()

    console.log(`OTP for ${phone}:`, otp) // In production, send via SMS provider

    res.status(201).json({ success: true, message: "User created. OTP sent to phone - verify using /api/auth/verify-otp" })
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

    if (!user.phoneOtp || !user.phoneOtpExpires || new Date() > user.phoneOtpExpires) {
      return res.status(400).json({ message: 'OTP expired or not found. Request a new OTP.' })
    }

    if (user.phoneOtp !== otp.toString()) {
      return res.status(400).json({ message: 'Invalid OTP' })
    }

    // Mark verified and clear OTP
    user.isPhoneVerified = true
    user.phoneOtp = undefined
    user.phoneOtpExpires = undefined
    user.phoneOtpSentAt = undefined
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
    const cooldownMs = 60 * 1000 // 60 seconds
    if (user.phoneOtpSentAt && now - new Date(user.phoneOtpSentAt).getTime() < cooldownMs) {
      return res.status(429).json({ message: 'OTP recently sent. Please wait before requesting another.' })
    }

    // Generate new OTP, update timestamps
    const otp = generateNumericOtp(6)
    user.phoneOtp = otp
    user.phoneOtpExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    user.phoneOtpSentAt = new Date()
    await user.save()

    console.log(`Resent OTP for ${phone}:`, otp) // TODO: integrate SMS provider

    res.json({ success: true, message: 'OTP resent to phone' })
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
