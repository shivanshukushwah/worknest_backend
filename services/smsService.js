const axios = require('axios')

// Simple SMS service with Fast2SMS support. Returns true when a message was sent
// Returns true in test env (no-op). Returns false when provider not configured.

const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY

async function sendSms(to, body) {
  // Ensure phone is provided
  if (!to || !body) return false

  // In tests or development, do nothing and allow assertions that rely on DB phoneOtp
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return true

  if (FAST2SMS_API_KEY) {
    try {
      // Format phone number - remove + and any spaces
      const formattedPhone = to.replace(/\+/g, '').replace(/\s/g, '')
      
      // Use query string format for Fast2SMS API
      const queryParams = new URLSearchParams({
        authorization: FAST2SMS_API_KEY,
        message: body,
        numbers: formattedPhone,
      }).toString()

      const response = await axios.get(
        `https://www.fast2sms.com/dev/bulkV2?${queryParams}`
      )
      
      console.log('✅ SMS sent successfully via Fast2SMS')
      return true
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.response?.data || err.message
      console.error('❌ Fast2SMS send error:', errorMsg)
      return false
    }
  }

  // No provider configured - do not log OTP. Return false so calling code can handle gracefully.
  return false
}

module.exports = { sendSms }
