// Profile validation service to check if a user's profile is complete based on their role

/**
 * Check if a user's profile is complete based on their role.
 * Returns { isComplete: boolean, missingFields: string[] }
 */
function validateProfileCompletion(user) {
  const missing = []

  // Common requirements for all roles
  if (!user.phone || !user.isPhoneVerified) {
    missing.push('phone_not_verified')
  }

  // Role-specific requirements
  if (user.role === 'student') {
    if (!user.skills || !Array.isArray(user.skills) || user.skills.length === 0) {
      missing.push('skills')
    }
    if (!user.education || !user.education.institution || !user.education.degree) {
      missing.push('education')
    }
    if (!user.location || !user.location.city || !user.location.state || !user.location.country) {
      missing.push('location')
    }
  }

  if (user.role === 'employer') {
    if (!user.businessName || user.businessName.trim() === '') {
      missing.push('businessName')
    }
    if (!user.businessAddress || !user.businessAddress.city || user.businessAddress.city.trim() === '') {
      missing.push('businessLocation')
    }
  }

  return {
    isComplete: missing.length === 0,
    missingFields: missing,
  }
}

/**
 * Get human-readable missing fields message
 */
function getMissingFieldsMessage(missingFields) {
  const fieldLabels = {
    phone_not_verified: 'Phone verification',
    skills: 'Skills',
    education: 'Education details',
    location: 'Location (city, state, country)',
    businessName: 'Business name',
    businessLocation: 'Business location',
  }

  const readable = missingFields.map(f => fieldLabels[f] || f).join(', ')
  return `Profile incomplete. Missing fields: ${readable}. Please update your profile and try again.`
}

module.exports = {
  validateProfileCompletion,
  getMissingFieldsMessage,
}
