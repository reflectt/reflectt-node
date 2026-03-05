// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect } from 'vitest'
import { getDashboardHTML } from '../src/dashboard.js'

describe('Dashboard internalMode gate', () => {
  it('hides intensity and pause controls by default (internalMode OFF)', () => {
    const html = getDashboardHTML()
    expect(html).not.toContain('id="intensity-control"')
    expect(html).not.toContain('id="pause-banner"')
    expect(html).not.toContain('id="pause-toggle-btn"')
    expect(html).not.toContain('setIntensity(')
    expect(html).not.toContain('toggleTeamPause()')
    expect(html).toContain('internal controls hidden')
  })

  it('hides controls when internalMode is explicitly false', () => {
    const html = getDashboardHTML({ internalMode: false })
    expect(html).not.toContain('id="intensity-control"')
    expect(html).not.toContain('id="pause-banner"')
    expect(html).toContain('internal controls hidden')
  })

  it('shows intensity and pause controls when internalMode is ON', () => {
    const html = getDashboardHTML({ internalMode: true })
    expect(html).toContain('id="intensity-control"')
    expect(html).toContain('id="pause-banner"')
    expect(html).toContain('id="pause-toggle-btn"')
    expect(html).toContain('setIntensity(')
    expect(html).toContain('toggleTeamPause()')
    expect(html).not.toContain('internal controls hidden')
  })

  it('always renders core dashboard elements regardless of mode', () => {
    const htmlOff = getDashboardHTML({ internalMode: false })
    const htmlOn = getDashboardHTML({ internalMode: true })

    for (const html of [htmlOff, htmlOn]) {
      expect(html).toContain('reflectt-node dashboard')
      expect(html).toContain('id="first-boot-banner"')
    }
  })
})
