const mongoose = require('mongoose')
const Wallet = require('../models/Wallet')
const Transaction = require('../models/Transaction')
const { PAYMENT_STATUS } = require('../utils/constants')

/**
 * WalletService: Provides atomic wallet operations that always create a Transaction
 * and update the Wallet within a single mongoose session when possible.
 */

async function addFunds(userId, amount, { session = null, description = 'Deposit', metadata = {}, gateway = null } = {}) {
  const ownSession = !session
  if (ownSession) session = await mongoose.startSession()

  try {
    if (ownSession) await session.withTransaction(async () => {
      await _addFundsTx(userId, amount, { session, description, metadata, gateway })
    })
    else {
      await _addFundsTx(userId, amount, { session, description, metadata, gateway })
    }

    return true
  } finally {
    if (ownSession) session.endSession()
  }
}

async function _addFundsTx(userId, amount, { session, description, metadata, gateway }) {
  const wallet = await Wallet.findOne({ user: userId }).session(session)
  if (!wallet) throw new Error('Wallet not found')

  wallet.balance = Number((wallet.balance + amount).toFixed(2))
  await wallet.save({ session })

  const tx = await Transaction.create([
    {
      user: userId,
      type: 'deposit',
      amount,
      status: PAYMENT_STATUS.COMPLETED,
      description,
      metadata: metadata || {},
      completedAt: new Date(),
    },
  ], { session })

  return { wallet, transaction: tx[0] }
}

async function requestWithdrawal(userId, amount, { session = null, description = 'Withdrawal to bank', metadata = {} } = {}) {
  // This creates a pending withdrawal and debits balance immediately (atomic)
  const ownSession = !session
  if (ownSession) session = await mongoose.startSession()

  try {
    if (ownSession) await session.withTransaction(async () => {
      await _requestWithdrawalTx(userId, amount, { session, description, metadata })
    })
    else await _requestWithdrawalTx(userId, amount, { session, description, metadata })

    return true
  } finally {
    if (ownSession) session.endSession()
  }
}

async function _requestWithdrawalTx(userId, amount, { session, description, metadata }) {
  const wallet = await Wallet.findOne({ user: userId }).session(session)
  if (!wallet) throw new Error('Wallet not found')
  if (wallet.balance < amount) throw new Error('Insufficient balance')

  wallet.balance = Number((wallet.balance - amount).toFixed(2))
  wallet.totalSpent = (wallet.totalSpent || 0) + amount
  await wallet.save({ session })

  const tx = await Transaction.create([
    {
      user: userId,
      type: 'withdrawal',
      amount,
      status: PAYMENT_STATUS.PENDING,
      description,
      metadata: metadata || {},
      initiatedAt: new Date(),
    },
  ], { session })

  return { wallet, transaction: tx[0] }
}

async function moveToEscrow(userId, amount, { session = null, description = 'Move to escrow', jobId = null } = {}) {
  const ownSession = !session
  if (ownSession) session = await mongoose.startSession()

  try {
    if (ownSession) await session.withTransaction(async () => {
      await _moveToEscrowTx(userId, amount, { session, description, jobId })
    })
    else await _moveToEscrowTx(userId, amount, { session, description, jobId })

    return true
  } finally {
    if (ownSession) session.endSession()
  }
}

async function _moveToEscrowTx(userId, amount, { session, description, jobId }) {
  const wallet = await Wallet.findOne({ user: userId }).session(session)
  if (!wallet) throw new Error('Wallet not found')
  if (wallet.balance < amount) throw new Error('Insufficient balance')

  wallet.balance = Number((wallet.balance - amount).toFixed(2))
  wallet.escrowBalance = Number((wallet.escrowBalance + amount).toFixed(2))
  await wallet.save({ session })

  const tx = await Transaction.create([
    {
      user: userId,
      type: 'payment',
      amount,
      status: PAYMENT_STATUS.COMPLETED,
      description,
      job: jobId,
      completedAt: new Date(),
    },
  ], { session })

  return { wallet, transaction: tx[0] }
}

async function releaseFromEscrow(job, { session = null } = {}) {
  // job should be a populated Job document with assignedStudent and employer
  const ownSession = !session
  if (ownSession) session = await mongoose.startSession()

  try {
    let result
    if (ownSession) await session.withTransaction(async () => {
      result = await _releaseFromEscrowTx(job, { session })
    })
    else result = await _releaseFromEscrowTx(job, { session })

    return result
  } finally {
    if (ownSession) session.endSession()
  }
}

async function _releaseFromEscrowTx(job, { session }) {
  const paymentAmount = job.escrowAmount || job.budget
  if (!paymentAmount || paymentAmount <= 0) throw new Error('No payment to release')

  const employerWallet = await Wallet.findOne({ user: job.employer }).session(session)
  if (!employerWallet) throw new Error('Employer wallet not found')
  if (employerWallet.escrowBalance < paymentAmount) throw new Error('Insufficient escrow balance')

  const studentWallet = await Wallet.findOne({ user: job.assignedStudent }).session(session)
  if (!studentWallet) throw new Error('Student wallet not found')

  const commissionRate = parseFloat(process.env.PLATFORM_COMMISSION_RATE) || 0.05
  const commissionAmount = Number((paymentAmount * commissionRate).toFixed(2))
  const payout = Number((paymentAmount - commissionAmount).toFixed(2))

  employerWallet.escrowBalance = Number((employerWallet.escrowBalance - paymentAmount).toFixed(2))
  await employerWallet.save({ session })

  studentWallet.balance = Number((studentWallet.balance + payout).toFixed(2))
  studentWallet.totalEarnings = Number((studentWallet.totalEarnings || 0) + payout)
  await studentWallet.save({ session })

  // platform commission handling
  const settings = await require('../models/Settings').findOne().session(session)
  const PLATFORM_USER_ID = process.env.PLATFORM_USER_ID || settings?.platformUserId

  let commissionTx = null
  if (PLATFORM_USER_ID) {
    let platformWallet = await Wallet.findOne({ user: PLATFORM_USER_ID }).session(session)
    if (!platformWallet) {
      platformWallet = new Wallet({ user: PLATFORM_USER_ID })
      await platformWallet.save({ session })
    }
    platformWallet.balance = Number((platformWallet.balance + commissionAmount).toFixed(2))
    await platformWallet.save({ session })

    commissionTx = await new Transaction({
      user: PLATFORM_USER_ID,
      type: 'commission',
      amount: commissionAmount,
      status: PAYMENT_STATUS.COMPLETED,
      description: `Commission for job: ${job.title}`,
      job: job._id,
      completedAt: new Date(),
    }).save({ session })
  } else {
    commissionTx = await new Transaction({
      user: job.employer,
      type: 'commission',
      amount: commissionAmount,
      status: PAYMENT_STATUS.COMPLETED,
      description: `Commission for job: ${job.title}`,
      job: job._id,
      completedAt: new Date(),
    }).save({ session })
  }

  const paymentTx = await new Transaction({
    user: job.employer,
    type: 'payment',
    amount: paymentAmount,
    status: PAYMENT_STATUS.COMPLETED,
    description: `Payment for job: ${job.title}`,
    job: job._id,
    relatedUser: job.assignedStudent,
    commissionRate,
    commissionAmount,
    completedAt: new Date(),
  }).save({ session })

  const earningTx = await new Transaction({
    user: job.assignedStudent,
    type: 'earning',
    amount: payout,
    status: PAYMENT_STATUS.COMPLETED,
    description: `Earning for job: ${job.title}`,
    job: job._id,
    relatedUser: job.employer,
    completedAt: new Date(),
  }).save({ session })

  // update job
  job.paymentReleased = true
  job.status = require('../utils/constants').JOB_STATUS.PAID
  job.escrowAmount = 0
  job.paidAt = new Date()
  await job.save({ session })

  return { paymentTx, earningTx, commissionTx }
}

module.exports = {
  addFunds,
  requestWithdrawal,
  moveToEscrow,
  releaseFromEscrow,
}
