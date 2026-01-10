const Joi = require("joi")

const validateReview = (data) => {
  const schema = Joi.object({
    jobId: Joi.string().required().messages({
      "any.required": "Job ID is required",
    }),
    rating: Joi.number().integer().min(1).max(5).required().messages({
      "number.min": "Rating must be at least 1",
      "number.max": "Rating cannot exceed 5",
      "any.required": "Rating is required",
    }),
    comment: Joi.string().max(500).allow("").messages({
      "string.max": "Comment cannot exceed 500 characters",
    }),
    aspectRatings: Joi.object({
      communication: Joi.number().integer().min(1).max(5),
      quality: Joi.number().integer().min(1).max(5),
      timeliness: Joi.number().integer().min(1).max(5),
      professionalism: Joi.number().integer().min(1).max(5),
    }),
  })

  return schema.validate(data)
}

const validateReviewResponse = (data) => {
  const schema = Joi.object({
    comment: Joi.string().min(1).max(300).required().messages({
      "string.min": "Response comment is required",
      "string.max": "Response cannot exceed 300 characters",
      "any.required": "Response comment is required",
    }),
  })

  return schema.validate(data)
}

module.exports = {
  validateReview,
  validateReviewResponse,
}
