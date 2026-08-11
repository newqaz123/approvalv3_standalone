#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { createEnvReport, parseEnvText } from './lib/env.mjs'

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const envPath = valueAfter('--env') ?? '.env.production'
const templatePath = valueAfter('--template') ?? '.env.example'

try {
  const [currentText, templateText] = await Promise.all([
    readFile(envPath, 'utf8'),
    readFile(templatePath, 'utf8'),
  ])
  const report = createEnvReport({
    current: parseEnvText(currentText),
    template: parseEnvText(templateText),
  })
  const issues = [
    ...report.missingRequired.map((key) => `Missing required key: ${key}`),
    ...report.originIssues,
    ...report.runtimeIssues,
  ]
  for (const warning of report.runtimeWarnings) console.warn(`Warning: ${warning}`)
  if (issues.length > 0) {
    for (const issue of issues) console.error(`Environment error: ${issue}`)
    process.exitCode = 1
  } else {
    console.log('Environment check passed')
  }
} catch (error) {
  console.error(`Environment check failed: ${error?.message ?? String(error)}`)
  process.exitCode = 1
}
