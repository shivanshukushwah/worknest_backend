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
    // ensure user object in response echoes data
    expect(res.body.user).toHaveProperty('age', 20)
    expect(res.body.user).toHaveProperty('education', 'BSc Computer Science from XYZ University')
    expect(res.body.user).toHaveProperty('phone', '+911234567892')
    // profile info should reflect completeness ignoring verification
    expect(res.body.profile).toBeDefined()
    expect(res.body.profile.isProfileComplete).toBe(true)
    expect(res.body.profile.missingFields).toHaveLength(0)
    // new fields added for percentage
    expect(res.body.profile).toHaveProperty('percentage', 100)
    expect(res.body.profile.totalFields).toBeGreaterThan(0)
    expect(res.body.profile.filledFields).toBe(res.body.profile.totalFields)
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

  test('should block re-registration when previous OTP is still valid', async () => {
    const payload = {
      name: 'First User',
      email: 'pending@example.com',
      password: 'password',
      confirmPassword: 'password',
      role: 'student',
      phone: '+911234567894',
      age: 23,
      education: 'BS',
      location: { city: 'City', state: 'ST', country: 'Country' }
    }
    // first registration creates a user with an unexpired OTP
    await request(app).post('/api/auth/register').send(payload).expect(201)

    // second attempt should be rejected with pending verification message
    const res2 = await request(app).post('/api/auth/register').send(payload).expect(409)
    expect(res2.body.message).toMatch(/pending verification/i)
  })

  test('should allow re-registration after OTP expiry and clean up ghost user', async () => {
    // create expired unverified user manually
    const hashed = await bcrypt.hash('password', 10)
    const old = await User.create({
      name: 'Expired',
      email: 'expired@example.com',
      password: hashed,
      role: 'student',
      phone: '+911234567895',
      age: 30,
      education: 'BA',
      location: { city: 'City', state: 'ST', country: 'Country' },
      emailOtp: '000000',
      emailOtpExpires: new Date(Date.now() - 1000), // already expired
      isEmailVerified: false,
    })

    const payload = {
      name: 'New User',
      email: 'expired@example.com',
      password: 'password',
      confirmPassword: 'password',
      role: 'student',
      phone: '+911234567895',
      age: 31,
      education: 'BS',
      location: { city: 'City', state: 'ST', country: 'Country' }
    }

    const res = await request(app).post('/api/auth/register').send(payload).expect(201)
    expect(res.body.success).toBe(true)

    const remaining = await User.find({ email: 'expired@example.com', role: 'student' })
    expect(remaining).toHaveLength(1)
    expect(remaining[0]._id.toString()).not.toBe(old._id.toString())
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
      emailOtp: '123456',
      emailOtpExpires: new Date(Date.now() + 10 * 60 * 1000),
      isEmailVerified: false,
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
    expect(res.body.user.isEmailVerified).toBe(true)
  })

  test('completion status returns partial percentage when some fields are missing', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({
      name: 'Partial',
      email: 'partial@example.com',
      password: hashed,
      role: 'student',
      // only email and name provided, nothing else
      isEmailVerified: false,
    })

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET)
    const res = await request(app)
      .get('/api/users/profile/completion-status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(res.body.data.percentage).toBeLessThan(100)
    expect(res.body.data.filledFields).toBeLessThan(res.body.data.totalFields)
  })

  test('resendOtp returns 404 and prompts re-register when OTP has expired', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const old = await User.create({
      name: 'Expired2',
      email: 'resend-expired@example.com',
      password: hashed,
      role: 'student',
      phone: '+911234560000',
      emailOtp: '999999',
      emailOtpExpires: new Date(Date.now() - 1000),
      isEmailVerified: false,
    })

    const res = await request(app)
      .post('/api/auth/resend-otp')
      .send({ email: 'resend-expired@example.com' })
      .expect(404)
    expect(res.body.message).toMatch(/register again/i)

    // ensure old record was deleted
    const found = await User.findOne({ email: 'resend-expired@example.com' })
    expect(found).toBeNull()
  })

  test('otpCleanup job removes expired unverified users', async () => {
    const hashed = await bcrypt.hash('password', 10)
    await User.create({
      name: 'CleanupTest',
      email: 'cleanup@example.com',
      password: hashed,
      role: 'student',
      phone: '+911234560001',
      emailOtp: '111111',
      emailOtpExpires: new Date(Date.now() - 5000),
      isEmailVerified: false,
    })

    // manually invoke cleanup logic
    const { startOtpCleanup, stopOtpCleanup } = require('../services/otpCleanup')
    // call cleanup once synchronously by reusing internal code (refactor below if necessary)
    await require('../services/otpCleanup').startOtpCleanup(1) // start with tiny interval
    // wait a moment for interval to run
    await new Promise(r => setTimeout(r, 20))
    stopOtpCleanup()

    const wiped = await User.findOne({ email: 'cleanup@example.com' })
    expect(wiped).toBeNull()
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
      isEmailVerified: true,
    })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'password', role: 'student' })
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.user).toHaveProperty('education', 'MBA')
    expect(res.body.user).toHaveProperty('location')
  })

  test('completion status ignores email verification and counts reg data', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({
      name: 'FillTest',
      email: 'fill@example.com',
      password: hashed,
      role: 'student',
      phone: '+911234512345',
      age: 28,
      education: 'BA',
      skills: ['coding'],
      location: { city: 'City', state: 'ST', country: 'Country' },
      // still unverified
      isEmailVerified: false,
    })

    // manually sign token for this user
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET)

    const res = await request(app)
      .get('/api/users/profile/completion-status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.data.isProfileComplete).toBe(true)
    expect(res.body.data.missingFields).not.toContain('age')
    expect(res.body.data.missingFields).not.toContain('education')
    expect(res.body.data.missingFields).not.toContain('skills')
    expect(res.body.data.missingFields).not.toContain('location')
    // emailVerified flag should correctly reflect status
    expect(res.body.data.emailVerified).toBe(false)
    expect(res.body.data.percentage).toBe(100)
    expect(res.body.data.totalFields).toBeGreaterThan(0)
    expect(res.body.data.filledFields).toBe(res.body.data.totalFields)
  })
})

describe('Resend OTP endpoint', () => {
  test('should resend OTP and set emailOtp and emailOtpSentAt', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({ name: 'Test', email: 't@example.com', password: hashed, phone: '+911234567890', isEmailVerified: false, role: 'student' })

    const res = await request(app).post('/api/auth/resend-otp').send({ email: user.email }).expect(200)
    expect(res.body.success).toBe(true)

    const fresh = await User.findById(user._id)
    expect(fresh.emailOtp).toBeDefined()
    expect(fresh.emailOtpSentAt).toBeDefined()
  })

  test('should enforce cooldown and return 429 if resent too quickly', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({ name: 'Test', email: 't2@example.com', password: hashed, phone: '+919876543210', isEmailVerified: false, emailOtpSentAt: new Date(), role: 'student' })

    const res = await request(app).post('/api/auth/resend-otp').send({ email: user.email }).expect(429)
    expect(res.body.message).toMatch(/OTP recently sent/i)
  })
})

describe('Wallet creation guard', () => {
  test('should block wallet creation when phone not verified', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({ 
      name: 'WUser', 
      email: 'w@example.com', 
      password: hashed, 
      phone: '+919000000001', 
      isEmailVerified: false, 
      role: 'student',
      age: 20,
      location: { city: 'TestCity', state: 'TS', country: 'TestCountry' },
      education: 'Test Education',
      skills: ['test']
    })

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET)

    const res = await request(app).post('/api/wallet').set('Authorization', `Bearer ${token}`).send().expect(403)
    expect(res.body.message).toMatch(/Email not verified/i)
  })

  test('should allow wallet creation after phone verified', async () => {
    const hashed = await bcrypt.hash('password', 10)
    const user = await User.create({ 
      name: 'WUser2', 
      email: 'w2@example.com', 
      password: hashed, 
      phone: '+919000000002', 
      isEmailVerified: true, 
      role: 'student',
      age: 21,
      location: { city: 'TestCity', state: 'TS', country: 'TestCountry' },
      education: 'Test Education',
      skills: ['test']
    })

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
