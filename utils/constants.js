const JOB_STATUS = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  PAID: "paid",
  CANCELLED: "cancelled",
  CLOSED: "closed",
}

const USER_ROLES = {
  STUDENT: "student",
  EMPLOYER: "employer",
  ADMIN: "admin",
}

const PAYMENT_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  REFUNDED: "refunded",
}

const NOTIFICATION_TYPES = {
  JOB_POSTED: "job_posted",
  JOB_ACCEPTED: "job_accepted",
  JOB_COMPLETED: "job_completed",
  PAYMENT_RELEASED: "payment_released",
  REVIEW_RECEIVED: "review_received",
  APPLICATION_RECEIVED: "application_received",
  JOB_SHORTLISTED: "job_shortlisted",
  JOB_NOT_SHORTLISTED: "job_not_shortlisted",
  PAYMENT_RECEIVED: "payment_received",
  JOB_APPROVED: "job_approved",
  JOB_CANCELLED: "job_cancelled",
  SYSTEM_ANNOUNCEMENT: "system_announcement",
}

// Scoring events and values
const SCORE_EVENTS = {
  NEW_STUDENT: 35,
  JOB_COMPLETED: 8,
  ON_TIME_SUBMISSION: 4,
  NO_SHOW_FAKE_APPLY: -20,
}

module.exports = {
  JOB_STATUS,
  USER_ROLES,
  PAYMENT_STATUS,
  NOTIFICATION_TYPES,
  SCORE_EVENTS,
}
