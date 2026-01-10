const express = require("express")
const { getWallet, createWallet, withdraw, getTransactions, getWalletStats, explainWallet, reconcileWallet } = require("../controllers/walletController")
const { auth, authorize } = require("../middleware/auth")

const router = express.Router()

// All routes require authentication
router.use(auth)

router.get("/", getWallet)
router.post("/", createWallet)
router.post("/withdraw", withdraw)
router.get("/transactions", getTransactions)
router.get("/stats", getWalletStats)
router.get("/explain", explainWallet)
// Admin reconciliation endpoint - adjust wallet and create audit transaction
router.post("/:userId/reconcile", authorize("admin"), reconcileWallet)

module.exports = router
