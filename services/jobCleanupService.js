const Job = require('../models/Job');
const { JOB_STATUS } = require('../utils/constants');

/**
 * Service to automatically close jobs whose deadlines have passed.
 */
const cleanupExpiredJobs = async () => {
    try {
        const now = new Date();
        
        // Find jobs that are OPEN and whose deadline has passed
        // We also check shortlistWindowEndsAt for online jobs as a secondary deadline
        const query = {
            status: JOB_STATUS.OPEN,
            $or: [
                { deadline: { $lt: now } },
                { 
                    jobType: 'online', 
                    shortlistWindowEndsAt: { $lt: now },
                    shortlistComputed: false 
                }
            ]
        };

        const expiredJobs = await Job.find(query);

        if (expiredJobs.length > 0) {
            console.log(`[JobCleanup] Found ${expiredJobs.length} expired jobs. Closing...`);
            
            const results = await Job.updateMany(
                { _id: { $in: expiredJobs.map(j => j._id) } },
                { 
                    $set: { 
                        status: JOB_STATUS.CLOSED,
                        closedAt: now
                    } 
                }
            );

            console.log(`[JobCleanup] Successfully closed ${results.modifiedCount} jobs.`);
        }
    } catch (error) {
        console.error('[JobCleanup] Error during job cleanup:', error);
    }
};

/**
 * Initialize the cleanup service to run periodically.
 * @param {number} intervalMs - Interval in milliseconds (default 5 minutes)
 */
const initJobCleanup = (intervalMs = 5 * 60 * 1000) => {
    console.log(`[JobCleanup] Initializing job cleanup service (interval: ${intervalMs / 60000} mins)`);
    
    // Run immediately on startup
    cleanupExpiredJobs();
    
    // Schedule periodic runs
    setInterval(cleanupExpiredJobs, intervalMs);
};

module.exports = {
    initJobCleanup,
    cleanupExpiredJobs
};
