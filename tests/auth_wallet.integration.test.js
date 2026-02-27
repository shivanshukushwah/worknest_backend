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

describe('Register endpoint', () => {
  test('should reject student signup without age', async () => {
    const payload = {
      name: 'Test Student',
      email: 'stu@example.com',
      password: 'password',
      confirmPassword: 'password',
      role: 'student',
      phone: '+911234567891',
      location: { city: 'City', state: 'ST', country: 'Country' }
    }
    const res = await request(app).post('/api/auth/register').send(payload).expect(400)
    expect(res.body.message).toMatch(/Age is required/i)
  })

  test('should succeed when student provides age and education', async () => {
    const payload = {
      name: 'Test Student',
      email: 'stu2@example.com',
      password: 'password',
      confirmPassword: 'password',
      role: 'student',
      phone: '+911234567892',
      age: 20,
      education: 'BSc Computer Science from XYZ University',
      location: { city: 'City', state: 'ST', country: 'Country' }
    }
    const res = await request(app).post('/api/auth/register').send(payload).expect(201)
    expect(res.body.success).toBe(true)
    expect(res.body.userId).toBeDefined()
  })

  test('should reject student signup without education', async () => {
    const payload = {
      name: 'Test Student',
      email: 'stu3@example.com',
      password: 'password',
      confirmPassword: 'password',
      role: 'student',
      phone: '+911234567893',
      age: 21,
      location: { city: 'City', state: 'ST', country: 'Country' }
    }
    const res = await request(app).post('/api/auth/register').send(payload).expect(400)
    expect(res.body.message).toMatch(/Education/i)
  })
})

describe('OTP verification and login responses', () => {
  test('verifyOtp returns full profile and sets isProfileComplete', async () => {
    const hashed = await bcrypt.hash('password', 10)
    // create a user with all student fields but not verified yet
    const user = await User.create({
      name: 'Complete Student',
      email: 'complete@example.com',
      password: hashed,
      phone: '+911234500000',
      role: 'student',
      age: 22,
      education: 'BSc Physics',
      skills: ['math'],
      location: { city: 'City', state: 'ST', country: 'Country' },
      phoneOtp: '123456',
      phoneOtpExpires: new Date(Date.now() + 10 * 60 * 1000),
      isPhoneVerified: false,
    })

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ userId: user._id, otp: '123456' })
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.user).toBeDefined()
    expect(res.body.user.age).toBe(22)
    expect(res.body.user.education).toBe('BSc Physics')
    expect(res.body.user.isProfileComplete).toBe(true)
    expect(res.body.user.isPhoneVerified).toBe(true)
  })

  test('login returns full user object', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({
      name: 'Login User',
      email: 'login@example.com',
      password: hashed,
      phone: '+911234500001',
      role: 'student',
      age: 25,
      education: 'MBA',
      skills: ['business'],
      location: { city: 'City', state: 'ST', country: 'Country' },
      isPhoneVerified: true,
    })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'password', role: 'student' })
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.user).toHaveProperty('education', 'MBA')
    expect(res.body.user).toHaveProperty('location')
  })
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
