import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { writeFileAtomic } from '../src/index.ts'

test('writeFileAtomic leaves no temp file and replaces content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'loreloom-'))
  try {
    const target = join(dir, 'nested', 'a.md')
    await writeFileAtomic(target, 'first')
    await writeFileAtomic(target, 'second')
    expect(await readdir(join(dir, 'nested'))).toEqual(['a.md'])
    expect(await readFile(target, 'utf8')).toBe('second')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
