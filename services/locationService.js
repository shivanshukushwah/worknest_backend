// Location utility service for distance calculations and location-based filtering

const EARTH_RADIUS_KM = 6371 // Earth's radius in kilometers

/**
 * Calculate distance between two geographic coordinates using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) {
    return null // Return null if coordinates are missing
  }

  const toRad = (angle) => (angle * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = EARTH_RADIUS_KM * c

  return distance
}

/**
 * Check if two locations match (same city/state/country)
 * Used for basic location matching without coordinates
 */
function isLocationMatch(userLocation, jobLocation) {
  if (!userLocation || !jobLocation) return false

  // Case-insensitive city and state matching
  const userCity = userLocation.city?.toLowerCase().trim() || ''
  const userState = userLocation.state?.toLowerCase().trim() || ''
  const jobCity = jobLocation.city?.toLowerCase().trim() || ''
  const jobState = jobLocation.state?.toLowerCase().trim() || ''

  // Match if both city and state are the same
  if (userCity && jobCity && userCity === jobCity && userState && jobState && userState === jobState) {
    return true
  }

  return false
}

/**
 * Check if a job is near a student's location
 * Can use either city/state matching or coordinate-based distance
 * Default radius: 50km if using coordinates
 */
function isJobNearby(userLocation, jobLocation, radiusKm = 50) {
  if (!userLocation || !jobLocation) return false

  // Try coordinate-based distance first
  if (
    userLocation.coordinates?.latitude &&
    userLocation.coordinates?.longitude &&
    jobLocation.coordinates?.latitude &&
    jobLocation.coordinates?.longitude
  ) {
    const distance = calculateDistance(
      userLocation.coordinates.latitude,
      userLocation.coordinates.longitude,
      jobLocation.coordinates.latitude,
      jobLocation.coordinates.longitude
    )
    if (distance !== null && distance <= radiusKm) {
      return true
    }
  }

  // Fall back to city/state matching
  return isLocationMatch(userLocation, jobLocation)
}

/**
 * Filter offline jobs by student location
 * Returns only jobs that are nearby the student
 */
function filterOfflineJobsByLocation(jobs, studentLocation, radiusKm = 50) {
  if (!studentLocation) return []

  return jobs.filter((job) => {
    // Only filter offline jobs
    if (job.jobType !== 'offline') return false
    // Include job if it's nearby
    return isJobNearby(studentLocation, job.location, radiusKm)
  })
}

/**
 * Filter jobs: return offline jobs near student, all online jobs
 */
function filterJobsByType(jobs, studentLocation, radiusKm = 50) {
  if (!jobs) return []

  const offlineJobs = jobs.filter((job) => job.jobType === 'offline')
  const onlineJobs = jobs.filter((job) => job.jobType === 'online')

  // Filter offline jobs by location, keep all online jobs
  const nearbyOfflineJobs = filterOfflineJobsByLocation(offlineJobs, studentLocation, radiusKm)

  return [...nearbyOfflineJobs, ...onlineJobs]
}

module.exports = {
  calculateDistance,
  isLocationMatch,
  isJobNearby,
  filterOfflineJobsByLocation,
  filterJobsByType,
}
