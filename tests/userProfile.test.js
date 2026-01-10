const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const jwt = require('jsonwebtoken')

const User = require('../models/User')

let mongoServer
let app

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  process.env.MONGO_URI = uri
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret'

  // Load app after env is set
  app = require('../server')
  await mongoose.connect(uri, { dbName: 'test' })
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

afterEach(async () => {
  await User.deleteMany({})
})

describe('User profile fields', () => {
  test('student profile contains expected fields', async () => {
    const student = await User.create({
      name: 'Student One',
      email: 'student@example.com',
      password: 'password',
      role: 'student',
      skills: ['js', 'node'],
      education: { institution: 'Uni', degree: 'BSc', year: 2020 },
      avatar: 'https://example.com/avatar.png',
      rating: { average: 4.5, count: 10 },
    })

    // Sign a token for an arbitrary user to access protected route
    const token = jwt.sign({ id: student._id, email: student.email, role: student.role }, process.env.JWT_SECRET)

    const res = await request(app).get(`/api/users/${student._id}`).set('Authorization', `Bearer ${token}`)

    expect(res.statusCode).toBe(200)
    const user = res.body.data
    expect(user).toHaveProperty('name', 'Student One')
    expect(user).toHaveProperty('skills')
    expect(user).toHaveProperty('education')
    expect(user).toHaveProperty('avatar')
    expect(user).toHaveProperty('rating')
    expect(user).toHaveProperty('score')
  })

  test('employer profile contains businessAddress and businessType', async () => {
    const employer = await User.create({
      name: 'Employer One',
      email: 'emp@example.com',
      password: 'password',
      role: 'employer',
      businessName: 'Acme Corp',
      businessType: 'cafe',
      businessAddress: { city: 'Mumbai', street: 'Main St' },
      avatar: 'https://example.com/emp.png',
    })

    const token = jwt.sign({ id: employer._id, email: employer.email, role: employer.role }, process.env.JWT_SECRET)

    const res = await request(app).get(`/api/users/${employer._id}`).set('Authorization', `Bearer ${token}`)

    expect(res.statusCode).toBe(200)
    const user = res.body.data
    expect(user).toHaveProperty('businessName', 'Acme Corp')
    expect(user).toHaveProperty('businessType', 'cafe')
    expect(user).toHaveProperty('businessAddress')
    expect(user.businessAddress).toHaveProperty('city', 'Mumbai')
  })
})