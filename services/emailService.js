const nodemailer = require('nodemailer')

// Create transporter for sending emails
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  })
}

// Send password reset email
async function sendPasswordResetEmail(userEmail, userName, resetToken, frontendUrl = 'http://localhost:3000') {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('Email service not configured. Reset token:', resetToken)
      return true // Return true to indicate success even if email not sent in test env
    }

    const transporter = createTransporter()
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: 'Password Reset Request',
      html: `
        <h2>Password Reset Request</h2>
        <p>Hi ${userName},</p>
        <p>You requested a password reset. Click the link below to reset your password:</p>
        <p><a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a></p>
        <p>Or copy and paste this link in your browser: ${resetUrl}</p>
        <p><strong>This link will expire in 1 hour.</strong></p>
        <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
        <p>Best regards,<br/>WorkNest Team</p>
      `,
    }

    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error('Error sending password reset email:', error.message)
    return false
  }
}

// Send password change confirmation email
async function sendPasswordChangeConfirmation(userEmail, userName) {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('Email service not configured. Password changed for:', userEmail)
      return true
    }

    const transporter = createTransporter()

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: 'Password Changed Successfully',
      html: `
        <h2>Password Changed</h2>
        <p>Hi ${userName},</p>
        <p>Your password has been successfully changed.</p>
        <p>If you did not make this change, please contact our support team immediately.</p>
        <p>Best regards,<br/>WorkNest Team</p>
      `,
    }

    await transporter.sendMail(mailOptions)
    return true
  } catch (error) {
    console.error('Error sending password change confirmation:', error.message)
    return false
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendPasswordChangeConfirmation,
}
