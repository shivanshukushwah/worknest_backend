const jwt = require("jsonwebtoken")

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET missing")
}

console.log("VERIFY SECRET:", process.env.JWT_SECRET)

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization
  console.log("Auth header:", authHeader)

  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" })
  }

  // Accept 'Bearer <token>' case-insensitive or raw token; strip quotes/whitespace
  let token = authHeader
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.split(" ")[1]
  }
  token = token.trim().replace(/^"|"$/g, "")

  // Decode without verifying to inspect header/payload (safe for debugging)
  const decodedUnverified = jwt.decode(token, { complete: true })
  console.log("Token (unverified):", decodedUnverified ? decodedUnverified.payload : null)

  const trimmedSecret = process.env.JWT_SECRET ? process.env.JWT_SECRET.trim().replace(/^"|"$/g, "") : undefined
  const rawSecret = process.env.JWT_SECRET

  // Try verifying with trimmed secret first, then fallback to raw secret for compatibility
  try {
    let decoded
    try {
      decoded = jwt.verify(token, trimmedSecret)
      console.log("Decoded token using trimmed secret:", decoded)
    } catch (errTrim) {
      console.warn("Trimmed secret verification failed:", errTrim.message)
      if (rawSecret && rawSecret !== trimmedSecret) {
        try {
          decoded = jwt.verify(token, rawSecret)
          console.log("Decoded token using raw secret (fallback):", decoded)
        } catch (errRaw) {
          console.error("Raw secret verification also failed:", errRaw.message)
          throw errRaw
        }
      } else {
        throw errTrim
      }
    }

    req.user = decoded
    next()
  } catch (err) {
    console.log("Auth middleware error:", err.message)
    return res.status(401).json({ message: "Invalid token" })
  }
}

/**
 * ROLE-BASED AUTHORIZATION
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Access denied: insufficient permissions",
      })
    }
    next()
  }
}

module.exports = { auth, authorize }
