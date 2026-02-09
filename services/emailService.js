import sgMail from '@sendgrid/mail'

sgMail.setApiKey(process.env.SENDGRID_API_KEY)

// Send password reset email
async function sendPasswordResetEmail(userEmail, userName, resetToken, frontendUrl = 'http://localhost:3000') {
  try {
    const msg = {
      to: userEmail,
      from: process.env.EMAIL_FROM,
      subject: 'Password Reset Request',
      html: `
        <h2>Password Reset Request</h2>
        <p>Hi ${userName},</p>
        <p>You requested a password reset. Click the link below to reset your password:</p>
        <p><a href="${frontendUrl}/reset-password?token=${resetToken}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a></p>
        <p>Or copy and paste this link in your browser: ${frontendUrl}/reset-password?token=${resetToken}</p>
        <p><strong>This link will expire in 1 hour.</strong></p>
        <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
        <p>Best regards,<br/>WorkNest Team</p>
      `,
    }

    await sgMail.send(msg)
    return true
  } catch (error) {
    console.error('Error sending password reset email:', error.message)
    return false
  }
}

// Send password change confirmation email
async function sendPasswordChangeConfirmation(userEmail, userName) {
  try {
    const msg = {
      to: userEmail,
      from: process.env.EMAIL_FROM,
      subject: 'Password Changed Successfully',
      html: `
        <h2>Password Changed</h2>
        <p>Hi ${userName},</p>
        <p>Your password has been successfully changed.</p>
        <p>If you did not make this change, please contact our support team immediately.</p>
        <p>Best regards,<br/>WorkNest Team</p>
      `,
    }

    await sgMail.send(msg)
    return true
  } catch (error) {
    console.error('Error sending password change confirmation:', error.message)
    return false
  }
}

// Send OTP via email
async function sendOtpEmail(userEmail, userName, otp) {
  try {
    const msg = {
      to: userEmail,
      from: process.env.EMAIL_FROM,
      subject: 'Your WorkNest Verification Code',
      html: `
        <h2>Verify Your Email</h2>
        <p>Hi ${userName},</p>
        <p>Your WorkNest verification code is:</p>
        <p style="font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 5px; margin: 20px 0;">${otp}</p>
        <p>This code will expire in <strong>10 minutes</strong>.</p>
        <p>If you did not request this code, please ignore this email.</p>
        <p>Best regards,<br/>WorkNest Team</p>
      `,
    }

    await sgMail.send(msg)
    console.log(`✅ OTP email sent to ${userEmail}`)
    return true
  } catch (error) {
    console.error('❌ Error sending OTP email:', error.message)
    // In development, show OTP in console as fallback
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n⚠️  Email failed. Development fallback - OTP for ${userEmail}: ${otp}\n`)
      return true
    }
    return false
  }
}

export {
  sendPasswordResetEmail,
  sendPasswordChangeConfirmation,
  sendOtpEmail,
}
