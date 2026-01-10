const Joi = require("joi")
const { USER_ROLES } = require("../utils/constants")

const validateSignup = (data) => {
  const schema = Joi.object({
    name: Joi.string().min(2).max(50).required().messages({
      "string.min": "Name must be at least 2 characters long",
      "string.max": "Name cannot exceed 50 characters",
      "any.required": "Name is required",
    }),
    email: Joi.string().email().required().messages({
      "string.email": "Please provide a valid email address",
      "any.required": "Email is required",
    }),
    password: Joi.string().min(6).required().messages({
      "string.min": "Password must be at least 6 characters long",
      "any.required": "Password is required",
    }),
    role: Joi.string()
      .valid(USER_ROLES.STUDENT, USER_ROLES.EMPLOYER)
      .required()
      .messages({
        "any.only": "Role must be either 'student' or 'employer'",
        "any.required": "Role is required",
      }),
    phone: Joi.string()
      .pattern(/^\+?[1-9]\d{1,14}$/)
      .required()
      .messages({
        "string.pattern.base": "Please provide a valid phone number",
        "any.required": "Phone number is required",
      }),
    skills: Joi.when("role", {
      is: "student",
      then: Joi.array().items(Joi.string().trim()),
      otherwise: Joi.forbidden(),
    }),
    businessName: Joi.when("role", {
      is: "employer",
      then: Joi.string().min(2).max(100).required().messages({
        "any.required": "Business name is required for employers",
      }),
      otherwise: Joi.forbidden(),
    }),
    businessType: Joi.when("role", {
      is: "employer",
      then: Joi.string().valid("shop", "cafe", "restaurant", "retail", "service", "other").required().messages({
        "any.only": "Business type must be one of shop, cafe, restaurant, retail, service, other",
        "any.required": "Business type is required for employers",
      }),
      otherwise: Joi.forbidden(),
    }),
    businessLocation: Joi.when("role", {
      is: "employer",
      then: Joi.string().min(2).max(200).required().messages({
        "any.required": "Business location is required for employers",
      }),
      otherwise: Joi.forbidden(),
    }),
  })

  return schema.validate(data)
}

const validateLogin = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Please provide a valid email address",
      "any.required": "Email is required",
    }),
    password: Joi.string().required().messages({
      "any.required": "Password is required",
    }),
  })

  return schema.validate(data)
}

module.exports = {
  validateSignup,
  validateLogin,
}
