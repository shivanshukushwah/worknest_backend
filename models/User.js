const mongoose = require("mongoose")

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["student", "employer", "admin"], required: true },
    phone: { type: String, unique: true, sparse: true },
    isPhoneVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isProfileComplete: { type: Boolean, default: false },
    // OTP fields
    phoneOtp: String,
    phoneOtpHash: String,
    phoneOtpExpires: Date,
    phoneOtpSentAt: Date,
    phoneOtpAttempts: { type: Number, default: 0 },
    phoneOtpBlocked: { type: Boolean, default: false },

    // Business fields (for employers)
    businessName: String,
    businessType: { type: String, enum: ["shop", "cafe", "restaurant", "retail", "service", "other"] },
    businessAddress: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
    },

    // Profile fields
    bio: String,
    skills: [String],
    avatar: String,
    profilePicture: String,
    
    // Location field (for students)
    location: {
      city: String,
      state: String,
      country: String,
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
    },

    // Rating & education
    rating: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    education: {
      institution: String,
      degree: String,
      year: Number,
    },
    lastLogin: Date,
    score: { type: Number, default: function() { return this.role === 'student' ? 35 : 0 } },

    // Password reset fields
    resetPasswordToken: String,
    resetPasswordExpires: Date,
  },
  { timestamps: true }
)

module.exports = mongoose.model("User", userSchema)
