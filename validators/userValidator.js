const Joi = require("joi")

const validateProfileUpdate = (data, userRole) => {
  const baseSchema = {
    name: Joi.string().min(2).max(50),
    phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/),
    bio: Joi.string().max(300),
    avatar: Joi.string().uri(),
    age: Joi.number().integer().min(13).max(100),
    userType: Joi.string().valid("student", "worker"),
    // Allow top-level location fields for flattening
    city: Joi.string().max(100).allow('', null),
    state: Joi.string().max(100).allow('', null),
    country: Joi.string().max(100).allow('', null),
    businessCity: Joi.string().max(100).allow('', null),
    businessState: Joi.string().max(100).allow('', null),
  }

  // Add role-specific validation
  if (userRole === "student" || userRole === "worker") {
    baseSchema.skills = Joi.array().items(Joi.string().trim().max(50))
    baseSchema.experience = Joi.string().valid("beginner", "intermediate", "advanced")
    baseSchema.education = Joi.object({
      institution: Joi.string().max(100),
      degree: Joi.string().max(100),
      year: Joi.number()
        .integer()
        .min(1950)
        .max(new Date().getFullYear() + 10),
    })
    baseSchema.location = Joi.object({
      city: Joi.string().max(100),
      state: Joi.string().max(100),
      country: Joi.string().max(100),
      coordinates: Joi.object({
        latitude: Joi.number().min(-90).max(90),
        longitude: Joi.number().min(-180).max(180),
      }),
    })
  }

  if (userRole === "employer") {
    baseSchema.businessName = Joi.string().min(2).max(100)
    baseSchema.businessType = Joi.string().valid("shop", "cafe", "restaurant", "retail", "service", "other")
    baseSchema.businessDescription = Joi.string().max(500)
    baseSchema.businessAddress = Joi.object({
      street: Joi.string().max(200),
      city: Joi.string().max(100),
      state: Joi.string().max(100),
      zipCode: Joi.string().max(20),
      coordinates: Joi.object({
        latitude: Joi.number().min(-90).max(90),
        longitude: Joi.number().min(-180).max(180),
      }),
    })
  }

  const schema = Joi.object(baseSchema)
  return schema.validate(data)
}

module.exports = {
  validateProfileUpdate,
}
