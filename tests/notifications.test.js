const request = require('supertest')
const mongoose = require('mongoose')
const app = require('../server') // ensure server exports the app for testing
const User = require('../models/User')
const Notification = require('../models/Notification')

let server

beforeAll(async () => {
  // connect to in-memory mongo or test db depending on your setup
  // For simplicity, this test expects the test runner to handle db setup (mongodb-memory-server)
  server = app.listen(0)
})

afterAll(async () => {
  await mongoose.connection.close()
  server.close()
})

describe('Notifications API', () => {
  test('GET /api/notifications returns notifications for authenticated user', async () => {
    // create a user and notification
    const user = await User.create({ name: 'test', email: 'test@example.com', password: 'hashed', role: 'student' })

    const token = require('jsonwebtoken').sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'testsecret')

    await Notification.create({ recipient: user._id, sender: user._id, type: 'info', title: 'Hi', message: 'hello' })

    const res = await request(server)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.data).toBeDefined()
    expect(res.body.data.unreadCount).toBeGreaterThanOrEqual(1)
  })
})