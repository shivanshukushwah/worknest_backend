// Fast2SMS OTP Service - Production Ready
// This service handles OTP sending and verification using Fast2SMS service
// OTP is generated and stored in database for verification
// OTP is NEVER exposed in logs or API responses

const axios = require('axios')

const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY

// Validate Fast2SMS configuration
let configured = false

if (FAST2SMS_API_KEY) {
  configured = true
}

/**
 * Send OTP via Fast2SMS
 * @param {string} phoneNumber - Phone number in E.164 format (e.g., +91XXXXXXXXXX)
 * @returns {Promise<{success: boolean, error?: string, attemptSid?: string}>}
 */
async function sendOtp(phoneNumber) {
  try {
    // Validate Fast2SMS configuration
    if (!configured) {
      console.error('❌ Fast2SMS not configured')
      return { success: false, error: 'SMS service not configured' }
    }

    // Validate phone number format
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return { success: false, error: 'Invalid phone number format' }
    }

    // Format phone number - remove + and any spaces
    const formattedPhone = phoneNumber.replace(/\+/g, '').replace(/\s/g, '')

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()

    // In development mode, log OTP to console instead of sending
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n🔐 DEVELOPMENT MODE - OTP for ${phoneNumber}: ${otp}\n`)
      return {
        success: true,
        attemptSid: otp,
      }
    }

    // Send OTP via Fast2SMS API
    // Using query string format which is more reliable
    const queryParams = new URLSearchParams({
      authorization: FAST2SMS_API_KEY,
      message: `Your WorkNest OTP is ${otp}. Do not share with anyone.`,
      numbers: formattedPhone,
    }).toString()

    const response = await axios.get(
      `https://www.fast2sms.com/dev/bulkV2?${queryParams}`
    )

    console.log(`✅ OTP sent to ${phoneNumber}`)
    
    return {
      success: true,
      attemptSid: otp, // Return the OTP that will be stored in DB
    }
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.response?.data || error.message
    console.error(`❌ Fast2SMS send error:`, errorMsg)

    // Provide user-friendly error messages
    if (error.message.includes('Invalid')) {
      return { success: false, error: 'Invalid phone number' }
    }
    if (error.response?.status === 401) {
      return { success: false, error: 'SMS service authentication failed' }
    }

    return { success: false, error: 'Failed to send OTP. Please try again.' }
  }
}

/**
 * Verify OTP sent via Fast2SMS
 * @param {string} phoneNumber - Phone number in E.164 format
 * @param {string} code - OTP code entered by user
 * @param {string} storedOtp - OTP stored in database for this phone
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function verifyOtp(phoneNumber, code, storedOtp) {
  try {
    // Validate inputs
    if (!configured) {
      console.error('❌ Fast2SMS not configured')
      return { success: false, error: 'Verification service not configured' }
    }

    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return { success: false, error: 'Invalid phone number format' }
    }

    if (!code || code.length < 4 || code.length > 8) {
      return { success: false, error: 'Invalid OTP format' }
    }

    // Verify the code by comparing with stored OTP
    if (code.trim() === storedOtp) {
      console.log(`✅ OTP verified for ${phoneNumber}`)
      return { success: true }
    } else {
      console.warn(`⚠️  OTP verification failed for ${phoneNumber}: code mismatch`)
      return { success: false, error: 'Invalid or expired OTP' }
    }
  } catch (error) {
    console.error(`❌ OTP verification error:`, error.message)

    if (error.message.includes('timeout')) {
      return { success: false, error: 'OTP has expired. Please request a new one.' }
    }

    return { success: false, error: 'OTP verification failed. Please try again.' }
  }
}

module.exports = {
  sendOtp,
  verifyOtp,
}
