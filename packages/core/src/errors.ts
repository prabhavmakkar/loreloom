import type { Card, Chapter } from './types.ts'

export class NotFoundError extends Error {
  override name = 'NotFoundError'
}

export class ConflictError extends Error {
  override name = 'ConflictError'
  constructor(
    message: string,
    public readonly current: Chapter | Card,
  ) {
    super(message)
  }
}

export class InvalidIdError extends Error {
  override name = 'InvalidIdError'
}

export class InvalidInputError extends Error {
  override name = 'InvalidInputError'
}

export class NotABookError extends Error {
  override name = 'NotABookError'
}

export class BookExistsError extends Error {
  override name = 'BookExistsError'
}
