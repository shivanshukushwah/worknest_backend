const mongoose = require("mongoose")

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["student", "worker", "employer", "admin"], required: true },
    phone: { type: String, sparse: true },
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
    
    // Student type: "student" or "worker" (only for role === "student")
    userType: { type: String, enum: ["student", "worker"], default: "student" },
    
    // Age (required for both student and worker)
    age: {
      type: Number,
      min: 13,
      max: 100,
      validate: {
        validator: function (v) {
          // require age when role is student or worker
          if (this.role === 'student' || this.role === 'worker') {
            return v != null
          }
          return true
        },
        message: 'Age is required for students/workers',
      },
    },
    
    // Location field (for students and workers)
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
    // Education - initially stored as string during registration
    // Later can be extended to object with institution, degree, year
    education: {
      type: String,
      validate: {
        validator: function(v) {
          if (this.role === 'student' || this.role === 'worker') {
            return v && v.trim() !== '';
          }
          return true;
        },
        message: 'Education is required for students/workers',
      },
    },
    lastLogin: Date,
    score: { type: Number, default: function() { return (this.role === 'student' || this.role === 'worker') ? 35 : 0 } },

    // Password reset fields
    resetPasswordToken: String,
    resetPasswordExpires: Date,
  },
  { timestamps: true, autoIndex: false }
)

// Unique compound indexes
// Same email can have different roles (student, employer)
userSchema.index({ email: 1, role: 1 }, { unique: true })

// Same phone can have different roles (student, employer) but not duplicate within same role
userSchema.index({ phone: 1, role: 1 }, { unique: true, sparse: true })

module.exports = mongoose.model("User", userSchema)
