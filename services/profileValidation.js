// Profile validation service to check if a user's profile is complete based on their role and type

/**
 * Check if a user's profile is complete based on their role and userType.
 * Returns { isComplete: boolean, missingFields: string[] }
 */
function validateProfileCompletion(user) {
  const missing = []

  // Common requirements for all roles
  if (!user.isEmailVerified) {
    missing.push('email_not_verified')
  }

  // Role-specific requirements
  if (user.role === 'student' || user.role === 'worker') {
    // Both student and worker types need age and location
    if (!user.age || user.age <= 0) {
      missing.push('age')
    }
    if (!user.location || !user.location.city || !user.location.state || !user.location.country) {
      missing.push('location')
    }

    // Student type specific requirements
    if (user.userType === 'student') {
      if (!user.skills || !Array.isArray(user.skills) || user.skills.length === 0) {
        missing.push('skills')
      }
      // Education is now stored as a string initially, so just check if it exists
      if (!user.education || (typeof user.education === 'string' && user.education.trim() === '')) {
        missing.push('education')
      }
    }
    // Worker type: only age and location needed (already checked above)
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
    email_not_verified: 'Email verification',
    skills: 'Skills',
    education: 'Education details',
    location: 'Location (city, state, country)',
    age: 'Age',
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
