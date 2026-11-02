import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}
