import { differenceInDays, differenceInHours } from 'date-fns'

console.log('Testing date-fns differenceInDays behavior:\n')

// Test case 1: Same day approvals
const sameDay1 = new Date('2026-02-06T15:35:56')
const sameDay2 = new Date('2026-02-06T15:35:57')
console.log('Test 1 - Same day (1 second apart):')
console.log(`  From: ${sameDay1.toISOString()}`)
console.log(`  To:   ${sameDay2.toISOString()}`)
console.log(`  differenceInDays: ${differenceInDays(sameDay2, sameDay1)}`)
console.log(`  differenceInHours: ${differenceInHours(sameDay2, sameDay1)}\n`)

// Test case 2: Next day (less than 24 hours)
const day1 = new Date('2026-02-06T23:00:00')
const day2 = new Date('2026-02-07T01:00:00')
console.log('Test 2 - Next day (2 hours later, less than 24h):')
console.log(`  From: ${day1.toISOString()}`)
console.log(`  To:   ${day2.toISOString()}`)
console.log(`  differenceInDays: ${differenceInDays(day2, day1)}`)
console.log(`  differenceInHours: ${differenceInHours(day2, day1)}\n`)

// Test case 3: More than 24 hours
const day3 = new Date('2026-02-06T15:00:00')
const day4 = new Date('2026-02-07T16:00:00')
console.log('Test 3 - More than 24 hours (25 hours):')
console.log(`  From: ${day3.toISOString()}`)
console.log(`  To:   ${day4.toISOString()}`)
console.log(`  differenceInDays: ${differenceInDays(day4, day3)}`)
console.log(`  differenceInHours: ${differenceInHours(day4, day3)}\n`)

// Test case 4: Exactly 24 hours
const day5 = new Date('2026-02-06T12:00:00')
const day6 = new Date('2026-02-07T12:00:00')
console.log('Test 4 - Exactly 24 hours:')
console.log(`  From: ${day5.toISOString()}`)
console.log(`  To:   ${day6.toISOString()}`)
console.log(`  differenceInDays: ${differenceInDays(day6, day5)}`)
console.log(`  differenceInHours: ${differenceInHours(day6, day5)}\n`)

console.log('--- CONCLUSION ---')
console.log('differenceInDays() rounds DOWN to whole days')
console.log('For time metrics, we should use differenceInHours() / 24 to get fractional days')
