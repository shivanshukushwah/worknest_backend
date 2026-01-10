const mongoose = require("mongoose")

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, "Wallet balance cannot be negative"],
    },
    escrowBalance: {
      type: Number,
      default: 0,
      min: [0, "Escrow balance cannot be negative"],
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
)

// Method to add funds to wallet
walletSchema.methods.addFunds = function (amount) {
  this.balance += amount
  return this.save()
}

// Method to deduct funds from wallet
walletSchema.methods.deductFunds = function (amount) {
  if (this.balance < amount) {
    throw new Error("Insufficient balance")
  }
  this.balance -= amount
  this.totalSpent += amount
  return this.save()
}

// Method to move funds to escrow
walletSchema.methods.moveToEscrow = function (amount) {
  if (this.balance < amount) {
    throw new Error("Insufficient balance")
  }
  this.balance -= amount
  this.escrowBalance += amount
  return this.save()
}

// Method to release funds from escrow
walletSchema.methods.releaseFromEscrow = function (amount) {
  if (this.escrowBalance < amount) {
    throw new Error("Insufficient escrow balance")
  }
  this.escrowBalance -= amount
  this.totalEarnings += amount
  return this.save()
}

// Method to refund from escrow to balance
walletSchema.methods.refundFromEscrow = function (amount) {
  if (this.escrowBalance < amount) {
    throw new Error("Insufficient escrow balance")
  }
  this.escrowBalance -= amount
  this.balance += amount
  return this.save()
}

module.exports = mongoose.model("Wallet", walletSchema)
