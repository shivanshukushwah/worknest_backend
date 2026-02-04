const Job = require('../models/Job')
const NotificationService = require('./notificationService')
const mongoose = require('mongoose')
const { NOTIFICATION_TYPES, JOB_STATUS } = require('../utils/constants')

let intervalHandle = null

// Process offline jobs: auto-close when FCFS limit reached
async function processOfflineJobAutoClose() {
  try {
    const now = new Date()
    // Find open offline jobs that have reached or exceeded FCFS application limit
    const offlineJobs = await Job.find({ jobType: 'offline', status: JOB_STATUS.OPEN })

    for (const job of offlineJobs) {
      const maxApplications = (job.positionsRequired || 1) * 3 // FCFS limit: 3× positionsRequired
      const currentApplications = (job.applications || []).length

      // Auto-close job if FCFS limit reached
      if (currentApplications >= maxApplications) {
        job.status = JOB_STATUS.CLOSED
        job.closedAt = new Date()
        await job.save()

        // Notify employer
        await NotificationService.createAndSendNotification({
          recipientId: job.employer,
          senderId: null,
          type: NOTIFICATION_TYPES.JOB_CLOSED,
          title: 'Job automatically closed',
          message: `Your job "${job.title}" has been automatically closed after reaching the FCFS application limit (${maxApplications} applications).`,
          jobId: job._id,
        })
      }
    }
  } catch (err) {
    console.error('Offline job auto-close error:', err)
  }
}

// Process online jobs: auto-shortlist after time window expires
async function processDueShortlists() {
  try {
    const now = new Date()
    const jobs = await Job.find({ jobType: 'online', shortlistWindowEndsAt: { $lte: now }, shortlistComputed: { $ne: true } })

    for (const job of jobs) {
      try {
        // Consider only applications submitted up to cutoff
        const cutoff = job.shortlistWindowEndsAt || now
        const appsInWindow = (job.applications || []).filter(a => a.createdAt && a.createdAt <= cutoff)

        // sort by evaluationScore desc, createdAt asc
        appsInWindow.sort((a, b) => {
          if ((b.evaluationScore || 0) !== (a.evaluationScore || 0)) return (b.evaluationScore || 0) - (a.evaluationScore || 0)
          return new Date(a.createdAt) - new Date(b.createdAt)
        })

        const shortlistLimit = (job.positionsRequired || 1) * (job.shortlistMultiplier || 3)
        const shortlistedApps = appsInWindow.slice(0, shortlistLimit)
        const shortlistedIds = new Set(shortlistedApps.map(a => a._id.toString()))

        job.applications.forEach((a) => {
          if (a.createdAt && a.createdAt <= cutoff) {
            a.shortlisted = shortlistedIds.has(a._id.toString())
          } else {
            // applications after cutoff remain unshortlisted
            a.shortlisted = false
          }
        })

        job.shortlistComputed = true
        job.shortlistedAt = new Date()
        await job.save()

        // Notify shortlisted applicants
        const notifications = []
        shortlistedApps.forEach((a) => {
          notifications.push(
            NotificationService.createAndSendNotification({
              recipientId: a.student,
              senderId: job.employer,
              type: NOTIFICATION_TYPES.JOB_SHORTLISTED,
              title: 'You have been shortlisted!',
              message: `You have been shortlisted for "${job.title}". Please wait for the employer to review and accept.`,
              jobId: job._id,
            }),
          )
        })

        await Promise.allSettled(notifications)

        // Notify applicants who applied within the window but were NOT shortlisted
        // Only notify those whose application is still in 'applied' status (skip accepted/withdrawn)
        const nonShortlistedApps = appsInWindow.filter(a => !shortlistedIds.has(a._id.toString()) && (a.status || 'applied') === 'applied')
        const nonNotifications = nonShortlistedApps.map((a) => {
          return NotificationService.createAndSendNotification({
            recipientId: a.student,
            senderId: job.employer,
            type: NOTIFICATION_TYPES.JOB_NOT_SHORTLISTED,
            title: 'Update on your application',
            message: `You were not shortlisted for "${job.title}". Thanks for applying — consider other openings or re-applying later.`,
            jobId: job._id,
          })
        })

        await Promise.allSettled(nonNotifications)
      } catch (err) {
        console.error('Error processing shortlist for job', job._id, err)
      }
    }
  } catch (err) {
    console.error('Shortlist scheduler error:', err)
  }
}

function startShortlistScheduler({ intervalMs = 60 * 1000 } = {}) {
  if (intervalHandle) return
  // Run immediately and then at interval
  processOfflineJobAutoClose()
  processDueShortlists()
  intervalHandle = setInterval(async () => {
    await processOfflineJobAutoClose()
    await processDueShortlists()
  }, intervalMs)
  console.log('Shortlist & auto-close scheduler started (intervalMs=', intervalMs, ')')
}

function stopShortlistScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}

module.exports = { startShortlistScheduler, stopShortlistScheduler, processDueShortlists }