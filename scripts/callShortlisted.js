(async ()=>{
  try {
    try { require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }) } catch (e) { }
    const mongoose = require('mongoose')
    const Job = require('../models/Job')
    const User = require('../models/User')
    const jwt = require('jsonwebtoken')
    const axios = require('axios')

    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test')
    const jobId = process.argv[2]
    if (!jobId) { console.error('Usage: node scripts/callShortlisted.js <jobId>'); process.exit(1) }

    const job = await Job.findById(jobId).lean()
    if (!job) { console.error('Job not found'); process.exit(1) }

    const employer = await User.findById(job.employer).lean()
    if (!employer) { console.error('Employer not found'); process.exit(1) }

    const token = jwt.sign({ id: employer._id, email: employer.email, role: employer.role }, (process.env.JWT_SECRET || 'testsecret'))

    console.log('Calling API as employer:', { id: employer._id.toString(), name: employer.name })
    const url = `http://localhost:5000/api/jobs/${jobId}/shortlisted`
    const resp = await axios.get(url, { headers: { Authorization: 'Bearer ' + token } })
    console.log('API response:', JSON.stringify(resp.data, null, 2))

    await mongoose.disconnect()
  } catch (err) {
    console.error('Error:', err.response ? err.response.data : err.message)
    process.exit(1)
  }
})()
