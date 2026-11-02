export type CardKind = 'character' | 'place' | 'rule' | 'term'

export const CARD_DIRS: Record<CardKind, string> = {
  character: 'characters',
  place: 'places',
  rule: 'rules',
  term: 'glossary',
}

export type ChapterStatus = 'idea' | 'drafting' | 'revising' | 'done'

export interface BookMeta {
  title: string
  author: string
  wordsPerPage: number
}

export interface Chapter {
  id: string
  title: string
  order: number
  status: ChapterStatus
  summary: string
  body: string
  version: string
}

export interface Relationship {
  to: string
  kind: string
  note?: string
}

export interface Card {
  kind: CardKind
  id: string
  name: string
  aliases: string[]
  summary: string
  body: string
  relationships: Relationship[]
  /** Extra frontmatter (e.g. pronunciation, role); round-trips untouched. */
  fields: Record<string, unknown>
  version: string
}
