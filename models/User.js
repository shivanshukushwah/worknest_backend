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
    phoneOtp: String,
    phoneOtpExpires: Date,
    phoneOtpSentAt: Date,

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
  },
  { timestamps: true }
)

module.exports = mongoose.model("User", userSchema)
