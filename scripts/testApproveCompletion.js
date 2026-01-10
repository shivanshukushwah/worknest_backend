(async ()=>{
  try {
    require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') })
  } catch (e) {}
  const axios = require('axios')
  const jwt = require('jsonwebtoken')
  const mongoose = require('mongoose')
  const Job = require('../models/Job')
  const User = require('../models/User')

  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test')
    const jobId = '69615b2fe17f13a8c78085e1'
    const job = await Job.findById(jobId).lean()
    if (!job) return console.error('Job not found')

    const emp = await User.findById(job.employer).lean()
    if (!emp) return console.error('Employer not found')

    const secret = process.env.JWT_SECRET || 'testsecret'
    const tokenEmp = jwt.sign({ id: emp._id, email: emp.email, role: emp.role }, secret)
    const base = process.env.BASE_URL || 'http://localhost:5000'

    console.log('Calling approve-completion as employer...')
    const res = await axios.put(`${base}/api/jobs/${jobId}/approve-completion`, {}, { headers: { Authorization: `Bearer ${tokenEmp}` } })
    console.log('Response:', JSON.stringify(res.data, null, 2))

    await mongoose.disconnect()
  } catch (err) {
    console.error('Error:', err.response ? err.response.data : err.message)
    process.exit(1)
  }
})()
