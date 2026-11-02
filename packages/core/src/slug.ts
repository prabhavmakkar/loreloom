const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_LEN = 60

export function isValidId(id: string): boolean {
  return ID_RE.test(id)
}

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LEN)
    .replace(/-+$/, '')
  return slug || 'untitled'
}

export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}
