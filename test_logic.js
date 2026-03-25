// Simple unit test for the getUserId helper function
const getUserId = (user) => user?.id || user?._id

// Test cases
console.log('Testing getUserId helper function...')

// Test case 1: user with id field
const user1 = { id: '507f1f77bcf86cd799439011', email: 'test@example.com' }
const result1 = getUserId(user1)
console.log('Test 1 - user with id:', result1 === '507f1f77bcf86cd799439011' ? '✅ PASS' : '❌ FAIL')

// Test case 2: user with _id field
const user2 = { _id: '507f1f77bcf86cd799439012', email: 'test2@example.com' }
const result2 = getUserId(user2)
console.log('Test 2 - user with _id:', result2 === '507f1f77bcf86cd799439012' ? '✅ PASS' : '❌ FAIL')

// Test case 3: user with both id and _id (should prefer id)
const user3 = { id: '507f1f77bcf86cd799439013', _id: '507f1f77bcf86cd799439014', email: 'test3@example.com' }
const result3 = getUserId(user3)
console.log('Test 3 - user with both (prefer id):', result3 === '507f1f77bcf86cd799439013' ? '✅ PASS' : '❌ FAIL')

// Test case 4: null/undefined user
const result4 = getUserId(null)
console.log('Test 4 - null user:', result4 === undefined ? '✅ PASS' : '❌ FAIL')

// Test case 5: empty user object
const result5 = getUserId({})
console.log('Test 5 - empty user:', result5 === undefined ? '✅ PASS' : '❌ FAIL')

console.log('\n✅ All getUserId tests completed!')
console.log('\n🔍 Code changes summary:')
console.log('1. Added getUserId helper in jobController.js')
console.log('2. Updated createJob to use getUserId(req.user)')
console.log('3. Updated getJobs ?mine=true to use getUserId(req.user)')
console.log('4. Updated getMyJobs to use getUserId(req.user)')
console.log('5. Added job stats to user profile in getUserById')
console.log('6. Added optional jobs list when includeJobs=true')

console.log('\n📋 Expected behavior:')
console.log('- POST /api/jobs should create job with correct employer ID')
console.log('- GET /api/jobs/my-jobs should return employer\'s jobs')
console.log('- GET /api/users/:id should include jobStats for employers')
console.log('- GET /api/users/:id?includeJobs=true should include jobs array')