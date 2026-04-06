const User = require("../models/User")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcrypt")
const crypto = require("crypto")
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

    const { name, email, password, confirmPassword, role, phone, location, businessName, businessType, businessLocation, age, skills, education, userType } = req.body

    // Verify passwords match (additional safeguard, though Joi should catch this)
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" })
    }

    // Before creating a new user, check for any conflicting accounts.  If we find an
    // unverified user whose OTP has already expired we delete that record so the
    // newcomer isn't blocked by a ghost account.  Otherwise we return the usual
    // conflict message (with a hint to verify or resend OTP when appropriate).
    const now = new Date()

    const existingUser = await User.findOne({ email, role })
    if (existingUser) {
      if (!existingUser.isEmailVerified) {
        if (existingUser.emailOtpExpires && now > existingUser.emailOtpExpires) {
          // OTP window passed – clean up and allow fresh registration
          await User.deleteOne({ _id: existingUser._id })
        } else {
          return res.status(409).json({
            message: `A ${role} account with this email is pending verification. Please check your email OTP or request a new one.`
          })
        }
      } else {
        // already verified user exists
        return res.status(409).json({ message: `You already have a ${role} account with this email` })
      }
    }

    // Also ensure phone isn't already registered with the same role
    if (phone) {
      const existingPhoneUser = await User.findOne({ phone, role })
      if (existingPhoneUser) {
        if (!existingPhoneUser.isEmailVerified) {
          if (existingPhoneUser.emailOtpExpires && now > existingPhoneUser.emailOtpExpires) {
            await User.deleteOne({ _id: existingPhoneUser._id })
          } else {
            return res.status(409).json({
              message: `A ${role} account with this phone number is pending verification. Please check your email OTP or request a new one.`
            })
          }
        } else {
          return res.status(409).json({ message: `This phone number is already registered as a ${role}` })
        }
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user but do not issue token until email verified
    const userData = {
      name,
      email,
      password: hashedPassword,
      role,
      phone,
      isEmailVerified: false,
    }

    if ((role === 'student' || role === 'worker') && location) {
      userData.location = {
        city: location.city,
        state: location.state,
        country: location.country,
      }
    }

    // Accept additional profile fields at signup for students/workers
    if (role === 'student' || role === 'worker') {
      if (typeof age !== 'undefined') userData.age = age
      if (skills) userData.skills = Array.isArray(skills) ? skills : [skills]
      if (education) userData.education = education
      if (userType) userData.userType = userType
    }

    if (role === 'employer') {
      userData.businessName = businessName
      userData.businessType = businessType
      userData.businessAddress = {
        city: businessLocation.city,
        state: businessLocation.state,
      }
    }

    // Default userType based on role if client did not provide one.
    // - role 'student' => userType 'student'
    // - role 'worker'  => userType 'worker'
    // Initialize score for both student/worker same as previous student flow.
    if (role === 'worker' || role === 'student') {
      if (!userData.userType) userData.userType = role === 'worker' ? 'worker' : 'student'
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
    user.emailOtp = otp
    user.emailOtpExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    await user.save()

    // prepare response user object without sensitive fields
    const respUser = user.toObject()
    delete respUser.password
    delete respUser.emailOtp
    delete respUser.emailOtpHash
    delete respUser.emailOtpExpires
    delete respUser.emailOtpSentAt
    delete respUser.emailOtpAttempts
    delete respUser.emailOtpBlocked

    // Flatten location for response
    if (respUser.location) {
      respUser.city = respUser.location.city
      respUser.state = respUser.location.state
      respUser.country = respUser.location.country
    }
    // Flatten businessAddress for employers
    if (respUser.businessAddress) {
      respUser.businessCity = respUser.businessAddress.city
      respUser.businessState = respUser.businessAddress.state
    }

    // compute profile completion ignoring email verification (which is false)
    let profileInfo = {}
    try {
      const { validateProfileCompletion } = require('../services/profileValidation')
      const profileValidation = validateProfileCompletion(user, { ignoreEmailVerification: true, includeOptional: true })
      profileInfo = {
        isProfileComplete: profileValidation.isComplete,
        missingFields: profileValidation.missingFields,
        totalFields: profileValidation.totalFields,
        filledFields: profileValidation.filledFields,
        percentage: profileValidation.percentage,
      }
    } catch (e) {
      console.error('Profile validation during register failed:', e)
    }

    res.status(201).json({ 
      success: true, 
      message: "OTP sent successfully to your email.",
      user: respUser, // return full user so client can keep registration values
      userId: user._id,
      profile: profileInfo,
    })
  } catch (err) {
    console.error("Register error:", err)
    res.status(500).json({ message: "Server error" })
  }
}

// ================= LOGIN =================
exports.login = async (req, res) => {
  try {
    const { email, password, role } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" })
    }

    if (!role) {
      return res.status(400).json({ message: "Role (student/employer) is required" })
    }

    // Find user by email AND role (since same email can have multiple accounts)
    const user = await User.findOne({ email, role })
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials or account not found" })
    }

    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    // Enforce email verification
    if (!user.isEmailVerified) {
      return res.status(403).json({ message: "Email not verified. Please verify your email to proceed." })
    }

    console.log("SIGN SECRET:", JWT_SECRET)

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    )

    // prepare full user data for response
    const userObj = user.toObject()
    delete userObj.password
    delete userObj.emailOtp
    delete userObj.emailOtpHash
    delete userObj.emailOtpExpires
    delete userObj.emailOtpSentAt
    delete userObj.emailOtpAttempts
    delete userObj.emailOtpBlocked

    // Flatten location for response
    if (userObj.location) {
      userObj.city = userObj.location.city
      userObj.state = userObj.location.state
      userObj.country = userObj.location.country
    }
    // Flatten businessAddress for employers
    if (userObj.businessAddress) {
      userObj.businessCity = userObj.businessAddress.city
      userObj.businessState = userObj.businessAddress.state
    }

    res.json({
      success: true,
      token,
      user: userObj,
    })
  } catch (err) {
    console.error("Login error:", err)
    res.status(500).json({ message: "Server error" })
  }
}

// Verify email OTP and issue token
// Accepts either { email, otp } or { userId, otp } so frontend can pass userId and only OTP input is needed
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp, userId } = req.body
    if (!otp) return res.status(400).json({ message: 'OTP is required' })

    let user
    if (userId) {
      user = await User.findById(userId)
    } else if (email) {
      user = await User.findOne({ email })
    } else {
      // no identifier provided; try to locate by OTP
      user = await User.findOne({ emailOtp: otp })
    }
    if (!user) return res.status(404).json({ message: 'User not found' })

    // Check if OTP exists and hasn't expired
    if (!user.emailOtp) {
      return res.status(400).json({ message: 'No OTP found. Please request a new one.' })
    }

    if (user.emailOtpExpires && new Date() > user.emailOtpExpires) {
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' })
    }

    // Verify OTP
    if (user.emailOtp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' })
    }

    // Mark email as verified and clear OTP
    user.isEmailVerified = true
    user.emailOtp = null
    user.emailOtpExpires = null

    // Determine profile completeness and update flag if needed
    try {
      const { validateProfileCompletion } = require('../services/profileValidation')
      const profileValidation = validateProfileCompletion(user)
      if (profileValidation.isComplete && !user.isProfileComplete) {
        user.isProfileComplete = true
      }
    } catch (e) {
      console.error('Profile validation during verifyOtp failed:', e)
    }

    await user.save()

    // After verification, auto-create wallet for all users
    try {
      const Wallet = require('../models/Wallet')
      const existingWallet = await Wallet.findOne({ user: user._id })
      if (!existingWallet) {
        await Wallet.create({ user: user._id })
      }
    } catch (e) {
      console.error('Auto-create wallet after verification failed:', e)
      // do not block verification on wallet errors
    }

    // Issue JWT token
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' })

    // Return full user object (omit sensitive fields)
    const userObj = user.toObject()
    delete userObj.password
    delete userObj.emailOtp
    delete userObj.emailOtpHash
    delete userObj.emailOtpExpires
    delete userObj.emailOtpSentAt
    delete userObj.emailOtpAttempts
    delete userObj.emailOtpBlocked

    // Flatten location for response
    if (userObj.location) {
      userObj.city = userObj.location.city
      userObj.state = userObj.location.state
      userObj.country = userObj.location.country
    }
    // Flatten businessAddress for employers
    if (userObj.businessAddress) {
      userObj.businessCity = userObj.businessAddress.city
      userObj.businessState = userObj.businessAddress.state
    }

    res.json({ 
      success: true, 
      message: 'Verified successfully',
      token, 
      user: userObj,
    })
  } catch (err) {
    console.error('Verify OTP error:', err)
    res.status(500).json({ message: 'Server error' })
  }
}

// Resend OTP (with cooldown)
exports.resendOtp = async (req, res) => {
  try {
    const { email, userId, phone } = req.body
    if (!email && !userId && !phone) return res.status(400).json({ message: 'Identifier (email, userId, or phone) is required' })

    let user
    if (userId) {
      user = await User.findById(userId)
    } else if (email) {
      user = await User.findOne({ email })
    } else if (phone) {
      user = await User.findOne({ phone })
    }

    // If record exists but OTP window expired, remove and ask client to start over.
    if (user && !user.isEmailVerified && user.emailOtpExpires && new Date() > user.emailOtpExpires) {
      await User.deleteOne({ _id: user._id })
      return res.status(404).json({ message: 'OTP has expired; please register again.' })
    }

    if (!user) return res.status(404).json({ message: 'User not found' })

    if (user.isEmailVerified) return res.status(400).json({ message: 'Account already verified' })

    // 60 second cooldown between OTP requests
    const now = Date.now()
    const cooldownMs = 60 * 1000
    if (user.emailOtpSentAt && now - new Date(user.emailOtpSentAt).getTime() < cooldownMs) {
      const secondsRemaining = Math.ceil((cooldownMs - (now - new Date(user.emailOtpSentAt).getTime())) / 1000)
      return res.status(429).json({ message: `OTP recently sent. Please wait ${secondsRemaining} seconds before requesting a new OTP.` })
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    
    // Use user's email for sending
    const targetEmail = user.email
    const emailSent = await emailService.sendOtpEmail(targetEmail, user.name, otp)
    
    if (!emailSent) {
      return res.status(500).json({ message: 'Failed to send OTP email' })
    }

    // Store OTP and track request time
    user.emailOtp = otp
    user.emailOtpExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    user.emailOtpSentAt = new Date()
    await user.save()

    res.json({ 
      success: true, 
      message: 'OTP sent successfully to your email.' ,
      userId: user._id
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
// ================= GET ACCOUNTS FOR EMAIL =================
// List all accounts (student/employer) for a given email
exports.getAccountsForEmail = async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ message: "Email is required" })
    }

    const accounts = await User.find({ email })
      .select('_id email role name businessName isProfileComplete')
      .exec()

    if (accounts.length === 0) {
      return res.status(404).json({ message: "No accounts found for this email" })
    }

    res.json({
      success: true,
      message: `Found ${accounts.length} account(s) for this email`,
      email,
      accounts,
    })
  } catch (err) {
    console.error("Get accounts error:", err)
    res.status(500).json({ message: "Server error" })
  }
}