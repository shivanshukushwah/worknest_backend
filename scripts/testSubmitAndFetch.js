(async ()=>{
  try {
    require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') })
  } catch (e) {}
  const mongoose = require('mongoose')
  const Job = require('../models/Job')
  const User = require('../models/User')
  const jwt = require('jsonwebtoken')
  const axios = require('axios')

  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test')
    const jobId = '69615b2fe17f13a8c78085e1'
    const job = await Job.findById(jobId).lean()
    if (!job) return console.error('Job not found')

    const employerId = job.employer
    const assignedStudent = job.assignedStudent || (job.assignedStudents && job.assignedStudents[0])
    if (!assignedStudent) return console.error('No assigned student to simulate submission')

    const secret = process.env.JWT_SECRET || 'testsecret'
    const stu = await User.findById(assignedStudent).lean()
    const emp = await User.findById(employerId).lean()
    if (!stu || !emp) return console.error('Missing users')

    const tokenStu = jwt.sign({ id: stu._id, email: stu.email, role: stu.role }, secret)
    const tokenEmp = jwt.sign({ id: emp._id, email: emp.email, role: emp.role }, secret)
    const base = process.env.BASE_URL || 'http://localhost:5000'

    console.log('Student:', stu._id.toString(), 'Employer:', emp._id.toString())

    // Submit work as student
    try {
      const res = await axios.put(`${base}/api/jobs/${jobId}/submit-work`, { description: 'Here are the deliverables', attachments: ['s3://bucket/file1.png'] }, { headers: { Authorization: `Bearer ${tokenStu}` } })
      console.log('submit response:', JSON.stringify(res.data, null, 2))
    } catch (e) {
      console.error('submit error:', e.response ? e.response.data : e.message)
    }

    // fetch job as employer
    try {
      const res2 = await axios.get(`${base}/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${tokenEmp}` } })
      console.log('job fetched by employer, submission:', JSON.stringify(res2.data.submission, null, 2))
    } catch (e) {
      console.error('fetch error:', e.response ? e.response.data : e.message)
    }

    await mongoose.disconnect()
  } catch (err) {
    console.error('Script error:', err)
    process.exit(1)
  }
})()
