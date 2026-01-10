const mongoose = require('mongoose')
const request = require('supertest')
const { MongoMemoryServer } = require('mongodb-memory-server')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const User = require('../models/User')
const Wallet = require('../models/Wallet')

let mongod
let app

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()
  process.env.MONGO_URI = uri
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret'

  // Require app after setting env so server connects to memory mongo
  app = require('../server')
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await User.deleteMany({})
  await Wallet.deleteMany({})
})

describe('Resend OTP endpoint', () => {
  test('should resend OTP and set phoneOtp and phoneOtpSentAt', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({ name: 'Test', email: 't@example.com', password: hashed, phone: '+911234567890', isPhoneVerified: false })

    const res = await request(app).post('/api/auth/resend-otp').send({ phone: user.phone }).expect(200)
    expect(res.body.success).toBe(true)

    const fresh = await User.findById(user._id)
    expect(fresh.phoneOtp).toBeDefined()
    expect(fresh.phoneOtpSentAt).toBeDefined()
  })

  test('should enforce cooldown and return 429 if resent too quickly', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({ name: 'Test', email: 't2@example.com', password: hashed, phone: '+919876543210', isPhoneVerified: false, phoneOtpSentAt: new Date() })

    const res = await request(app).post('/api/auth/resend-otp').send({ phone: user.phone }).expect(429)
    expect(res.body.message).toMatch(/OTP recently sent/i)
  })
})

describe('Wallet creation guard', () => {
  test('should block wallet creation when phone not verified', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({ name: 'WUser', email: 'w@example.com', password: hashed, phone: '+919000000001', isPhoneVerified: false, role: 'student' })

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET)

    const res = await request(app).post('/api/wallet').set('Authorization', `Bearer ${token}`).send().expect(403)
    expect(res.body.message).toMatch(/Phone number not verified/i)
  })

  test('should allow wallet creation after phone verified', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({ name: 'WUser2', email: 'w2@example.com', password: hashed, phone: '+919000000002', isPhoneVerified: true, role: 'student' })

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET)

    const res = await request(app).post('/api/wallet').set('Authorization', `Bearer ${token}`).send().expect(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user).toBeDefined()
    // Wallet should exist
    const wallet = await Wallet.findOne({ user: user._id })
    expect(wallet).not.toBeNull()
    expect(wallet.balance).toBe(0)
  })
})
