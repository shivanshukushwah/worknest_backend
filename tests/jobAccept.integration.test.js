const mongoose = require('mongoose')
const request = require('supertest')
const { MongoMemoryServer } = require('mongodb-memory-server')
const jwt = require('jsonwebtoken')

const Job = require('../models/Job')
const User = require('../models/User')

let mongod
let app

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()
  process.env.MONGO_URI = uri
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret'
  app = require('../server')
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await Job.deleteMany({})
  await User.deleteMany({})
})

test('accepting applications closes job when positionsRequired reached', async () => {
  // Create employer and students
  const employer = await User.create({ name: 'Emp', email: 'emp@example.com', password: 'hashed', role: 'employer', phone: '+911111111111', isPhoneVerified: true })
  const s1 = await User.create({ name: 'S1', email: 's1@example.com', password: 'h', role: 'student' })
  const s2 = await User.create({ name: 'S2', email: 's2@example.com', password: 'h', role: 'student' })
  const s3 = await User.create({ name: 'S3', email: 's3@example.com', password: 'h', role: 'student' })

  const token = jwt.sign({ id: employer._id, email: employer.email, role: employer.role }, process.env.JWT_SECRET)

  // Create job with positionsRequired = 2
  const job = await Job.create({ title: 'J', description: 'D', category: 'c', budget: 100, duration: '1d', employer: employer._id, positionsRequired: 2, applications: [ { student: s1._id }, { student: s2._id }, { student: s3._id } ] })

  const app1Id = job.applications[0]._id
  const app2Id = job.applications[1]._id
  const app3Id = job.applications[2]._id

  // Accept first application
  let res = await request(app).put(`/api/jobs/${job._id}/applications/${app1Id}/accept`).set('Authorization', `Bearer ${token}`).expect(200)
  expect(res.body.success).toBe(true)
  let updated = await Job.findById(job._id)
  expect(updated.acceptedCount).toBe(1)
  expect(updated.status).toBe('in_progress')

  // Accept second application - should fill positions and close job
  res = await request(app).put(`/api/jobs/${job._id}/applications/${app2Id}/accept`).set('Authorization', `Bearer ${token}`).expect(200)
  expect(res.body.success).toBe(true)
  updated = await Job.findById(job._id)
  expect(updated.acceptedCount).toBe(2)
  expect(updated.status).toBe('closed')

  // Attempt to accept third - should be rejected
  res = await request(app).put(`/api/jobs/${job._id}/applications/${app3Id}/accept`).set('Authorization', `Bearer ${token}`).expect(400)
  expect(res.body.success).toBe(false)
})

test('student accepts assignment -> job becomes in_progress and can submit work', async () => {
  const employer = await User.create({ name: 'Emp2', email: 'emp2@example.com', password: 'hashed', role: 'employer', phone: '+911111111112', isPhoneVerified: true })
  const student = await User.create({ name: 'Stu', email: 'stu@example.com', password: 'h', role: 'student' })
  const tokenEmp = jwt.sign({ id: employer._id, email: employer.email, role: employer.role }, process.env.JWT_SECRET)
  const tokenStu = jwt.sign({ id: student._id, email: student.email, role: student.role }, process.env.JWT_SECRET)

  const job = await Job.create({ title: 'AssignJob', description: 'D', category: 'c', budget: 100, duration: '1d', employer: employer._id, positionsRequired: 1, applications: [ { student: student._id } ] })
  const appId = job.applications[0]._id

  // Employer accepts the application
  let res = await request(app).put(`/api/jobs/${job._id}/applications/${appId}/accept`).set('Authorization', `Bearer ${tokenEmp}`).expect(200)
  expect(res.body.success).toBe(true)

  // Student accepts assignment
  res = await request(app).put(`/api/jobs/${job._id}/accept-assignment`).set('Authorization', `Bearer ${tokenStu}`).expect(200)
  expect(res.body.success).toBe(true)

  const updated = await Job.findById(job._id)
  expect(updated.studentAccepted).toBe(true)
  expect(updated.status).toBe('in_progress')

  // Student submits work
  res = await request(app).put(`/api/jobs/${job._id}/submit-work`).set('Authorization', `Bearer ${tokenStu}`).send({ description: 'done' }).expect(200)
  expect(res.body.success).toBe(true)
})