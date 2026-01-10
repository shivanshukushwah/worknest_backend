const Job = require('../models/Job')
const ProfileInspector = require('./profileInspector')

let queue = []
let running = false
let intervalHandle = null

async function processOne(task) {
  try {
    // mark inspecting
    await Job.updateOne({ _id: task.jobId, 'applications._id': task.applicationId }, { $set: { 'applications.$.inspection.status': 'inspecting' } })

    const job = await Job.findById(task.jobId).lean()
    const app = job.applications.find(a => String(a._id) === String(task.applicationId))

    const jobContext = { skills: job.skillsRequired || [], category: job.category }
    const result = await ProfileInspector.inspectProfileUrl(task.profileUrl, jobContext)

    if (result.success) {
      // Combine existing evaluationScore (base) + extraScore
      const baseScore = app.evaluationScore || 0
      const combined = Math.min(100, baseScore + (result.extraScore || 0))

      await Job.updateOne({ _id: task.jobId, 'applications._id': task.applicationId }, {
        $set: {
          'applications.$.evaluationScore': combined,
          'applications.$.inspection.status': 'done',
          'applications.$.inspection.result': result.details || {},
          'applications.$.inspection.inspectedAt': new Date(),
        }
      })
    } else {
      await Job.updateOne({ _id: task.jobId, 'applications._id': task.applicationId }, {
        $set: {
          'applications.$.inspection.status': 'failed',
          'applications.$.inspection.error': result.reason || 'inspection_failed',
          'applications.$.inspection.inspectedAt': new Date(),
        }
      })
    }
  } catch (err) {
    console.error('Error processing inspection task', err)
    try {
      await Job.updateOne({ _id: task.jobId, 'applications._id': task.applicationId }, {
        $set: {
          'applications.$.inspection.status': 'failed',
          'applications.$.inspection.error': err.message,
          'applications.$.inspection.inspectedAt': new Date(),
        }
      })
    } catch (e) {
      console.error('Failed to mark inspection failed', e)
    }
  }
}

async function processQueue() {
  if (running) return
  running = true
  while (queue.length) {
    const task = queue.shift()
    await processOne(task)
  }
  running = false
}

function startInspectionQueue({ intervalMs = 5 * 1000 } = {}) {
  if (intervalHandle) return
  intervalHandle = setInterval(processQueue, intervalMs)
  console.log('Inspection queue started (intervalMs=', intervalMs, ')')
}

function stopInspectionQueue() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}

function enqueue(task) {
  // task: { jobId, applicationId, profileUrl }
  queue.push(task)
  // mark queued in DB
  Job.updateOne({ _id: task.jobId, 'applications._id': task.applicationId }, { $set: { 'applications.$.inspection.status': 'queued' } }).catch(err => console.error('Failed to mark queued', err))
}

module.exports = { enqueue, startInspectionQueue, stopInspectionQueue, _queue: () => queue }
