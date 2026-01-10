const adminAuth = require("./middleware/adminAuth")

module.exports = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    return next()
  }
  res.status(403).json({ message: "Admin access only" })
}

app.get("/api/admin/analytics", adminAuth, adminController.getAnalytics)
app.get("/api/admin/users", adminAuth, adminController.listUsers)
app.get("/api/admin/jobs", adminAuth, adminController.listJobs)