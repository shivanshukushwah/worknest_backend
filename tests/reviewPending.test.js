const mongoose = require('mongoose')
const request = require('supertest')
const { MongoMemoryServer } = require('mongodb-memory-server')
const jwt = require('jsonwebtoken')

const User = require('../models/User')
const Job = require('../models/Job')
const Review = require('../models/Review')

let mongoServer
let app

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  process.env.MONGO_URI = uri
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret'
  app = require('../server')
  await mongoose.connect(uri, { dbName: 'test' })
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

afterEach(async () => {
  await User.deleteMany({})
  await Job.deleteMany({})
  await Review.deleteMany({})
})

test('GET /api/reviews/pending returns trimmed job views without applications', async () => {
  const employer = await User.create({ name: 'Emp', email: 'emp@example.com', password: 'p', role: 'employer', phone: '+911' })
  const student = await User.create({ name: 'Stu', email: 'stu@example.com', password: 'p', role: 'student', phone: '+912' })

  const job = await Job.create({
    title: 'Cafe Helper',
    description: 'Need helper for cafe work',
    category: 'offline',
    budget: 300,
    duration: '1',
    employer: employer._id,
    postedBy: employer._id,
    assignedStudent: student._id,
    assignedStudents: [student._id],
    positionsRequired: 1,
    acceptedCount: 1,
    jobType: 'offline',
    status: 'paid',
    paymentReleased: true,
    submission: { description: 'Here is the completed work', attachments: [], submittedAt: new Date() },
  })

  const token = jwt.sign({ id: student._id, email: student.email, role: student.role }, process.env.JWT_SECRET)

  const res = await request(app).get('/api/reviews/pending').set('Authorization', `Bearer ${token}`).expect(200)
  expect(res.body.success).toBe(true)
  expect(Array.isArray(res.body.data)).toBe(true)
  expect(res.body.data.length).toBeGreaterThanOrEqual(1)

  const item = res.body.data.find(i => i._id === job._id.toString() || i._id === job._id)
  expect(item).toBeTruthy()
  // Ensure applications array is not present
  expect(item.applications).toBeUndefined()
  // Submission should be present
  expect(item.submission).toHaveProperty('description')
  expect(item.assignedStudent).toBeTruthy()
})