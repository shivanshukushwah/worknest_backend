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

test('offline job: limit applications to positionsRequired*3 and close', async () => {
  const employer = await User.create({ name: 'Emp', email: 'emp1@example.com', password: 'p', role: 'employer', phone: '+911' })
  const job = await Job.create({ title: 'Offline Job', description: 'x', category: 'a', budget: 100, duration: '1', employer: employer._id, positionsRequired: 3, jobType: 'offline' })

  // 9 students apply
  for (let i = 0; i < 9; i++) {
    const stud = await User.create({ name: `S${i}`, email: `s${i}@e.com`, password: 'p', role: 'student', phone: `+91${1000 + i}` })
    const token = jwt.sign({ id: stud._id, email: stud.email, role: stud.role }, process.env.JWT_SECRET)
    await request(app).post(`/api/jobs/${job._id}/apply`).set('Authorization', `Bearer ${token}`).send().expect(201)
  }

  // 10th should be rejected
  const stud10 = await User.create({ name: 'S9', email: `s9@e.com`, password: 'p', role: 'student', phone: `+911009` })
  const token10 = jwt.sign({ id: stud10._id, email: stud10.email, role: stud10.role }, process.env.JWT_SECRET)
  const res = await request(app).post(`/api/jobs/${job._id}/apply`).set('Authorization', `Bearer ${token10}`).send()
  expect(res.statusCode).toBe(400)
  expect(res.body.message).toMatch(/Applications closed/i)

  const fresh = await Job.findById(job._id)
  expect(fresh.status).toBe('closed')
})

test('online job: require profileUrl and shortlist top N', async () => {
  const employer = await User.create({ name: 'Emp2', email: 'emp2@example.com', password: 'p', role: 'employer', phone: '+912' })
  const job = await Job.create({ title: 'Online Job', description: 'x', category: 'a', budget: 100, duration: '5', employer: employer._id, positionsRequired: 2, jobType: 'online', shortlistMultiplier: 3 })

  // Create 10 students with various URLs
  const domains = ['linkedin.com', 'github.com', 'behance.net', 'example.com/profile', 'linkedin.com/in/john-doe', 'github.com/janedoe']
  for (let i = 0; i < 10; i++) {
    const stud = await User.create({ name: `O${i}`, email: `o${i}@e.com`, password: 'p', role: 'student', phone: `+91200${i}` })
    const token = jwt.sign({ id: stud._id, email: stud.email, role: stud.role }, process.env.JWT_SECRET)
    const url = `https://${domains[i % domains.length]}/user${i}`
    await request(app).post(`/api/jobs/${job._id}/apply`).set('Authorization', `Bearer ${token}`).send({ profileUrl: url }).expect(201)
  }

  const fresh = await Job.findById(job._id)
  const shortlistLimit = job.positionsRequired * job.shortlistMultiplier
  const shortlisted = fresh.applications.filter(a => a.shortlisted)
  expect(shortlisted.length).toBe(shortlistLimit)

  // Try to accept a non-shortlisted application -> should fail
  const nonShort = fresh.applications.find(a => !a.shortlisted)
  const tokenEmp = jwt.sign({ id: employer._id, email: employer.email, role: employer.role }, process.env.JWT_SECRET)
  const res = await request(app).put(`/api/jobs/${job._id}/applications/${nonShort._id}/accept`).set('Authorization', `Bearer ${tokenEmp}`).send()
  expect(res.statusCode).toBe(400)
})