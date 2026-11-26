// Copied unchanged (below this header) from the agent-workflow kit:
// team-workflow 0.2.1, hooks/lib/check-knowledge.mjs. The kit repo is private,
// so CI can't fetch it; refresh this copy when the kit's rules change.
// Run: npm run domain:check

// Checks a project's domain skill folder against the reference-file rules.
// Used by the SessionStart hook, the kit's tests, and (as a CLI) by knowledge
// plugins in their own CI:
//
//   node check-knowledge.mjs <path/to/skills/domain>
//
// Exit codes: 0 no problems, 1 problems (one per line on stdout), 2 usage.
// Node built-ins only: this runs inside every session start.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_FILES = ['glossary.md', 'invariants.md']
const INVARIANT_FIELDS = [
  ['never', 'Never'],
  ['why', 'Why'],
  ['enforcedBy', 'Enforced by'],
  ['codeToday', 'Code today'],
  ['test', 'Test at the boundary']
]

// Strip a leading byte-order mark (some Windows editors add one) and CRLF.
const readText = (path) =>
  readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
const isDir = (path) => existsSync(path) && statSync(path).isDirectory()
const isFile = (path) => existsSync(path) && statSync(path).isFile()

export function checkDomainSkill(dirPath) {
  if (!isDir(dirPath)) return [`no domain skill at ${dirPath}`]
  // Any unexpected read error becomes a problem to report, never a crash.
  try {
    return collectProblems(dirPath)
  } catch (error) {
    return [`could not check ${dirPath}: ${error.message}`]
  }
}

function collectProblems(dirPath) {
  const problems = []
  const referenceDir = join(dirPath, 'reference')
  const referenceFiles = []
  if (existsSync(referenceDir)) {
    if (!isDir(referenceDir)) {
      problems.push('reference: not a folder')
    } else {
      for (const name of readdirSync(referenceDir).filter((f) => f.endsWith('.md')).sort()) {
        if (isFile(join(referenceDir, name))) referenceFiles.push(name)
        else problems.push(`reference/${name}: not a file`)
      }
    }
  }

  for (const name of REQUIRED_FILES) {
    if (!referenceFiles.includes(name)) problems.push(`reference/${name}: missing`)
  }

  for (const name of referenceFiles) {
    problems.push(...checkReferenceFile(name, readText(join(referenceDir, name))))
  }

  problems.push(...checkSkillFile(dirPath, referenceFiles))

  if (referenceFiles.includes('invariants.md')) {
    problems.push(
      ...checkInvariants(readText(join(referenceDir, 'invariants.md'))).map(
        (p) => `reference/invariants.md: ${p}`
      )
    )
  }

  return problems
}

function checkReferenceFile(name, text) {
  const problems = []
  const firstLine = text.split('\n')[0]
  const match = firstLine.match(/^Last reviewed: (\d{4}-\d{2}-\d{2})$/)
  if (!match) {
    problems.push(`reference/${name}: line 1 must be "Last reviewed: YYYY-MM-DD", got "${firstLine}"`)
  } else {
    const date = new Date(`${match[1]}T00:00:00Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) {
      problems.push(`reference/${name}: invalid date ${match[1]}`)
    }
  }
  if (!/^Sources:/m.test(text)) problems.push(`reference/${name}: no "Sources:" line`)
  return problems
}

function checkSkillFile(dirPath, referenceFiles) {
  const skillPath = join(dirPath, 'SKILL.md')
  if (!existsSync(skillPath)) return ['SKILL.md: missing']
  if (!isFile(skillPath)) return ['SKILL.md: not a file']

  const skill = readText(skillPath)
  const problems = []
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatter) {
    problems.push('SKILL.md: no frontmatter')
  } else {
    if (!/^name: domain$/m.test(frontmatter[1])) {
      problems.push('SKILL.md: frontmatter must have "name: domain"')
    }
    if (!/^description: .{20,}/m.test(frontmatter[1])) {
      problems.push('SKILL.md: frontmatter needs a description of at least 20 characters')
    }
  }
  for (const name of referenceFiles) {
    if (!skill.includes(`reference/${name}`)) {
      problems.push(`SKILL.md: does not link reference/${name}`)
    }
  }
  return problems
}

// Every `### ` heading ends the block above it, so a field under a later,
// non-invariant heading is never credited to an invariant. Headings that start
// "INV-" but don't carry a valid INV-NNN ID are returned as malformed.
function parseInvariants(text) {
  const invariants = []
  const malformed = []
  const headings = [...text.matchAll(/^### (.*)$/gm)]
  headings.forEach((heading, i) => {
    const title = heading[1].trim()
    if (!title.startsWith('INV-')) return
    const id = title.match(/^(INV-\d{3})\b/)?.[1]
    if (!id) {
      malformed.push(title.split(/\s/)[0])
      return
    }
    const end = i + 1 < headings.length ? headings[i + 1].index : text.length
    const block = text.slice(heading.index, end)
    const field = (label) =>
      block.match(new RegExp(`^- \\*\\*${label}:\\*\\* *(.+)$`, 'm'))?.[1]?.trim()
    invariants.push({
      id,
      offset: heading.index,
      fields: Object.fromEntries(INVARIANT_FIELDS.map(([key, label]) => [key, field(label)])),
      status: field('Status')
    })
  })
  return { invariants, malformed }
}

function checkInvariants(text) {
  const problems = []
  const { invariants, malformed } = parseInvariants(text)
  for (const bad of malformed) problems.push(`"### ${bad}" is not a valid ID; use INV-NNN`)
  if (invariants.length === 0) problems.push('no invariants found')

  invariants.forEach((inv, i) => {
    const expectedId = `INV-${String(i + 1).padStart(3, '0')}`
    if (inv.id !== expectedId) problems.push(`${inv.id} is out of order; expected ${expectedId}`)
    for (const [key, label] of INVARIANT_FIELDS) {
      if (!inv.fields[key]) problems.push(`${inv.id} is missing "${label}"`)
    }
    if (!/^(Confirmed|Unconfirmed)$/.test(inv.status ?? '')) {
      problems.push(`${inv.id} has status "${inv.status ?? ''}"; must be Confirmed or Unconfirmed`)
    }
  })

  const headings = [...text.matchAll(/^## (.+)$/gm)]
  const last = headings[headings.length - 1]
  if (!last || last[1].trim() !== 'Unconfirmed') {
    problems.push('the last ## heading must be "Unconfirmed"')
    return problems
  }
  for (const inv of invariants) {
    if (inv.status === 'Unconfirmed' && inv.offset < last.index) {
      problems.push(`${inv.id} is Unconfirmed but sits above "Unconfirmed"`)
    } else if (inv.status === 'Confirmed' && inv.offset > last.index) {
      problems.push(`${inv.id} is Confirmed but sits under "Unconfirmed"`)
    }
  }
  return problems
}

// CLI entry, only when run directly (not when imported). Node resolves
// import.meta.url to the real path, so resolve argv[1] through any symlink or
// junction too, or a linked kit path would silently skip the check.
const thisFile = fileURLToPath(import.meta.url)
const realPath = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}
const invoked = process.argv[1] ? realPath(process.argv[1]) : ''
const isMain =
  process.platform === 'win32'
    ? invoked.toLowerCase() === thisFile.toLowerCase()
    : invoked === thisFile

if (isMain) {
  const target = process.argv[2]
  if (!target) {
    process.stderr.write('usage: node check-knowledge.mjs <path/to/skills/domain>\n')
    process.exit(2)
  }
  const problems = checkDomainSkill(resolve(target))
  if (problems.length > 0) {
    process.stdout.write(`${problems.join('\n')}\n`)
    process.exit(1)
  }
}
