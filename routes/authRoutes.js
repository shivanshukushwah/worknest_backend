const express = require("express")
const router = express.Router()
const authController = require("../controllers/authController")

// Register route
router.post("/register", authController.register)

// Login route
router.post("/login", authController.login)

// Get all accounts for an email (student/employer accounts)
router.post("/accounts-for-email", authController.getAccountsForEmail)

// Verify OTP to complete registration
router.post("/verify-otp", authController.verifyOtp)

// Resend OTP
router.post("/resend-otp", authController.resendOtp)

// Forgot password - send reset email
router.post("/forgot-password", authController.forgotPassword)

// Reset password - verify token and set new password
router.post("/reset-password", authController.resetPassword)

// Optional: logout, refresh token, etc.
router.post("/logout", authController.logout)

module.exports = router
