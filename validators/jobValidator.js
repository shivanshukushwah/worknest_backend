const Joi = require("joi")

const allowedCategories = ["cafe", "shop", "delivery", "education", "it", "healthcare", "other"]

const validateJobPost = (data) => {
  const schema = Joi.object({
    title: Joi.string().min(5).max(100).required().messages({
      "string.min": "Job title must be at least 5 characters long",
      "string.max": "Job title cannot exceed 100 characters",
      "any.required": "Job title is required",
    }),
    description: Joi.string().min(20).max(1000).required().messages({
      "string.min": "Job description must be at least 20 characters long",
      "string.max": "Job description cannot exceed 1000 characters",
      "any.required": "Job description is required",
    }),
    category: Joi.string().valid(...allowedCategories).required(),
    skillsRequired: Joi.array().items(Joi.string().trim().max(50)),
    budget: Joi.number().min(1).required().messages({
      "number.min": "Budget must be at least $1",
      "any.required": "Budget is required",
    }),
    duration: Joi.string()
      .valid("1-2 hours", "3-5 hours", "6-8 hours", "1 day", "2-3 days", "1 week", "2+ weeks")
      .required()
      .messages({
        "any.only": "Please select a valid duration",
        "any.required": "Duration is required",
      }),
    urgency: Joi.string().valid("low", "medium", "high"),
    location: Joi.object({
      type: Joi.string().valid("remote", "on-site", "hybrid").required(),
      address: Joi.when("type", {
        is: Joi.valid("on-site", "hybrid"),
        then: Joi.object({
          street: Joi.string().max(200),
          city: Joi.string().max(100).required(),
          state: Joi.string().max(100).required(),
          zipCode: Joi.string().max(20),
          coordinates: Joi.object({
            latitude: Joi.number().min(-90).max(90),
            longitude: Joi.number().min(-180).max(180),
          }),
        }),
        otherwise: Joi.object(),
      }),
    }).required(),
  })

  return schema.validate(data)
}

const validateJobApplication = (data) => {
  const schema = Joi.object({
    coverLetter: Joi.string().max(500).messages({
      "string.max": "Cover letter cannot exceed 500 characters",
    }),
    proposedRate: Joi.number().min(1).messages({
      "number.min": "Proposed rate must be at least $1",
    }),
  })

  return schema.validate(data)
}

module.exports = {
  validateJobPost,
  validateJobApplication,
}
