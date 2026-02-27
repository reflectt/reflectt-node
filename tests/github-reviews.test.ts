// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { parsePrUrl } from '../src/github-reviews.js'

describe('github-reviews', () => {
  it('parsePrUrl parses standard PR urls', () => {
    const parsed = parsePrUrl('https://github.com/reflectt/reflectt-node/pull/123')
    expect(parsed).toEqual({ owner: 'reflectt', repo: 'reflectt-node', pullNumber: 123 })
  })

  it('parsePrUrl returns null for invalid urls', () => {
    expect(parsePrUrl('https://github.com/reflectt/reflectt-node/issues/1')).toBe(null)
    expect(parsePrUrl('nope')).toBe(null)
  })
})
