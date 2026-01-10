const User = require('../models/User')
const ScoreLog = require('../models/ScoreLog')
const mongoose = require('mongoose')
const { SCORE_EVENTS } = require('../utils/constants')

async function adjustScore(userId, delta, event, { reason = '', meta = {}, session = null } = {}) {
  const ownSession = !session
  if (ownSession) session = await mongoose.startSession()

  try {
    if (ownSession) await session.withTransaction(async () => {
      await _adjustScoreTx(userId, delta, event, { reason, meta, session })
    })
    else await _adjustScoreTx(userId, delta, event, { reason, meta, session })

    return true
  } finally {
    if (ownSession) session.endSession()
  }
}

async function _adjustScoreTx(userId, delta, event, { reason, meta, session }) {
  const user = await User.findById(userId).session(session)
  if (!user) throw new Error('User not found')

  user.score = (user.score || 0) + delta
  await user.save({ session })

  await ScoreLog.create([
    {
      user: userId,
      event,
      delta,
      reason,
      meta,
    },
  ], { session })
}

module.exports = {
  adjustScore,
}