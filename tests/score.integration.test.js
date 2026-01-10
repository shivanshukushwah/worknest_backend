const mongoose = require('mongoose')
const request = require('supertest')
const { MongoMemoryServer } = require('mongodb-memory-server')
const jwt = require('jsonwebtoken')

const User = require('../models/User')
const Job = require('../models/Job')

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
})

test('new student gets initial score and job completion awards points', async () => {
  const student = await User.create({ name: 'S', email: 's@example.com', password: 'p', role: 'student', phone: '+91111111', isPhoneVerified: true })
  const employer = await User.create({ name: 'E', email: 'e@example.com', password: 'p', role: 'employer', phone: '+92222222', isPhoneVerified: true })

  const job = await Job.create({ title: 'Test Job', description: 'x', category: 'a', budget: 100, duration: '2', employer: employer._id, assignedStudent: student._id, assignedStudents: [student._id], studentAccepted: true, status: 'in_progress' })

  // student initial score
  const s = await User.findById(student._id)
  expect(s.score).toBe(35)

  const tokenEmp = jwt.sign({ id: employer._id, email: employer.email, role: employer.role }, process.env.JWT_SECRET)
  // Employer approves completion
  const res = await request(app).put(`/api/jobs/${job._id}/approve-completion`).set('Authorization', `Bearer ${tokenEmp}`).send().expect(200)
  const s2 = await User.findById(student._id)
  expect(s2.score).toBe(35 + 8)
})

test('on-time submission awards on-time score', async () => {
  const student = await User.create({ name: 'S2', email: 's2@example.com', password: 'p', role: 'student', phone: '+91111112', isPhoneVerified: true })
  const employer = await User.create({ name: 'E2', email: 'e2@example.com', password: 'p', role: 'employer', phone: '+92222223', isPhoneVerified: true })

  const job = await Job.create({ title: 'Test Job2', description: 'x', category: 'a', budget: 100, duration: '5', employer: employer._id, assignedStudent: student._id, assignedStudents: [student._id], studentAccepted: true, status: 'in_progress' })

  const tokenStud = jwt.sign({ id: student._id, email: student.email, role: student.role }, process.env.JWT_SECRET)

  const res = await request(app).put(`/api/jobs/${job._id}/submit-work`).set('Authorization', `Bearer ${tokenStud}`).send({ description: 'done', attachments: [] }).expect(200)

  const s2 = await User.findById(student._id)
  // initial 35 + 4 on-time
  expect(s2.score).toBe(35 + 4)
})

test('application rejection does not penalize student', async () => {
  const student = await User.create({ name: 'S3', email: 's3@example.com', password: 'p', role: 'student', phone: '+91111113', isPhoneVerified: true })
  const employer = await User.create({ name: 'E3', email: 'e3@example.com', password: 'p', role: 'employer', phone: '+92222224', isPhoneVerified: true })

  const job = await Job.create({ title: 'Test Job3', description: 'x', category: 'a', budget: 100, duration: '5', employer: employer._id, applications: [{ student: student._id, coverLetter: 'x' }] })

  const application = job.applications[0]
  const tokenEmp = jwt.sign({ id: employer._id, email: employer.email, role: employer.role }, process.env.JWT_SECRET)

  const res = await request(app).put(`/api/jobs/${job._id}/applications/${application._id}/reject`).set('Authorization', `Bearer ${tokenEmp}`).send().expect(200)

  const s2 = await User.findById(student._id)
  expect(s2.score).toBe(35)
})
