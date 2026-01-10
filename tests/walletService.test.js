const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const Wallet = require('../models/Wallet')
const Transaction = require('../models/Transaction')
const WalletService = require('../services/walletService')

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await Wallet.deleteMany({})
  await Transaction.deleteMany({})
})

test('addFunds should create wallet deposit transaction and update balance', async () => {
  const userId = new mongoose.Types.ObjectId()
  await Wallet.create({ user: userId })

  const res = await WalletService.addFunds(userId, 150, { description: 'Test deposit' })

  const wallet = await Wallet.findOne({ user: userId })
  const txs = await Transaction.find({ user: userId })

  expect(wallet.balance).toBe(150)
  expect(txs.length).toBe(1)
  expect(txs[0].type).toBe('deposit')
  expect(txs[0].status).toBe('completed')
})

test('requestWithdrawal should create pending withdrawal and deduct balance', async () => {
  const userId = new mongoose.Types.ObjectId()
  await Wallet.create({ user: userId, balance: 300 })

  const res = await WalletService.requestWithdrawal(userId, 100, { description: 'Test withdraw' })

  const wallet = await Wallet.findOne({ user: userId })
  const txs = await Transaction.find({ user: userId })

  expect(wallet.balance).toBe(200)
  expect(wallet.totalSpent).toBe(100)
  expect(txs.length).toBe(1)
  expect(txs[0].type).toBe('withdrawal')
  expect(txs[0].status).toBe('pending')
})
