const axios = require('axios')

// Simple SMS service with Twilio support. Returns true when a message was sent
// Returns true in test env (no-op). Returns false when provider not configured.

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM = process.env.TWILIO_FROM

async function sendSms(to, body) {
  // Ensure phone is provided
  if (!to || !body) return false

  // In tests, do nothing and allow assertions that rely on DB phoneOtp
  if (process.env.NODE_ENV === 'test') return true

  if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
    try {
      const client = require('twilio')(TWILIO_SID, TWILIO_TOKEN)
      await client.messages.create({ body, from: TWILIO_FROM, to })
      return true
    } catch (err) {
      console.error('Twilio send error:', err.message)
      return false
    }
  }

  // No provider configured - do not log OTP. Return false so calling code can handle gracefully.
  return false
}

module.exports = { sendSms }
