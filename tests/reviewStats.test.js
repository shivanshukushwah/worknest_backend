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

test('GET /api/reviews/stats/:userId returns stats for a user with reviews', async () => {
  const employer = await User.create({ name: 'Emp', email: 'emp@example.com', password: 'p', role: 'employer', phone: '+911' })
  const student = await User.create({ name: 'Stu', email: 'stu@example.com', password: 'p', role: 'student', phone: '+912' })

  const job = await Job.create({ title: 'J', description: 'x', category: 'a', budget: 100, duration: '1', employer: employer._id })

  // Create a review with aspectRatings
  await Review.create({ job: job._id, reviewer: employer._id, reviewee: student._id, rating: 5, comment: 'Great', aspectRatings: { communication: 5, quality: 4, timeliness: 4, professionalism: 5 }, isPublic: true })

  const res = await request(app).get(`/api/reviews/stats/${student._id}`).expect(200)
  expect(res.body.success).toBe(true)
  expect(res.body.data).toHaveProperty('averageRating')
  expect(res.body.data).toHaveProperty('totalReviews')
  expect(res.body.data.averageAspectRatings).toHaveProperty('communication')
})
