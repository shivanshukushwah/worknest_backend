const express = require("express")
const router = express.Router()
const authController = require("../controllers/authController")

// Register route
router.post("/register", authController.register)

// Login route
router.post("/login", authController.login)

// Verify OTP to complete registration
router.post("/verify-otp", authController.verifyOtp)

// Resend OTP
router.post("/resend-otp", authController.resendOtp)

// Optional: logout, refresh token, etc.
router.post("/logout", authController.logout)

module.exports = router
