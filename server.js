const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
console.log("BOOT JWT_SECRET:", process.env.JWT_SECRET)
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");

const app = express();
app.use(express.json());

/* =======================
   ✅ CORS (FINAL FIX)
   ======================= */
app.use(
  cors({
    origin: true,       // 🔥 allow ANY origin (localhost + LAN IP)
    credentials: true,
  })
);

// allow preflight requests (handled by CORS middleware)
// app.options("/*", cors());

/* =======================
   ✅ MongoDB
   ======================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

/* =======================
   ✅ Routes
   ======================= */
const jobsRouter = require("./routes/jobs");
const walletRouter = require("./routes/wallet");
const paymentsRouter = require("./routes/payments");
const usersRouter = require("./routes/users");
const reviewsRouter = require("./routes/reviews");

app.use("/api/auth", authRoutes);
app.use("/api/jobs", jobsRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/users", usersRouter);
app.use("/api/reviews", reviewsRouter);

/* =======================
   ✅ Other Controllers
   ======================= */
const adminController = require("./controllers/adminController");
const notificationRouter = require("./routes/notification");

app.get("/api/admin/analytics", adminController.getAnalytics);
app.get("/api/admin/users", adminController.listUsers);
app.get("/api/admin/jobs", adminController.listJobs);

app.use("/api/notifications", notificationRouter);

/* =======================
   ✅ Health Check
   ======================= */
app.get("/", (req, res) => {
  res.send("API is running");
});

/* =======================
   ✅ Server Start
   ======================= */
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const { startShortlistScheduler } = require('./services/shortlistScheduler')

// Don't start the server when required as a module (useful for tests)
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
    // Start background workers
    startShortlistScheduler()

    // Start inspection queue worker if enabled
    try {
      const { startInspectionQueue } = require('./services/inspectionQueue')
      startInspectionQueue()
    } catch (e) {
      console.error('Failed to start inspection queue:', e)
    }
  });
}

module.exports = app;