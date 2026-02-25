import { describe, it, expect } from 'vitest'
import {
  normalizeArtifactPath,
  normalizeTaskArtifactPaths,
  buildGitHubBlobUrl,
  buildGitHubRawUrl,
} from '../src/artifact-resolver.js'

describe('normalizeArtifactPath', () => {
  it('passes through repo-relative paths unchanged', () => {
    const result = normalizeArtifactPath('process/QA-bundle.md')
    expect(result.normalized).toBe('process/QA-bundle.md')
    expect(result.wasNormalized).toBe(false)
    expect(result.rejected).toBe(false)
  })

  it('strips absolute OpenClaw workspace prefix', () => {
    const result = normalizeArtifactPath('/Users/ryan/.openclaw/workspace-link/process/task-123-qa.md')
    expect(result.normalized).toBe('process/task-123-qa.md')
    expect(result.wasAbsolute).toBe(true)
    expect(result.wasNormalized).toBe(true)
    expect(result.rejected).toBe(false)
  })

  it('strips absolute reflectt home prefix', () => {
    const result = normalizeArtifactPath('/Users/ryan/.reflectt/process/artifact.md')
    expect(result.normalized).toBe('process/artifact.md')
    expect(result.wasAbsolute).toBe(true)
    expect(result.wasNormalized).toBe(true)
  })

  it('strips relative workspace-shared/ prefix', () => {
    const result = normalizeArtifactPath('workspace-shared/process/QA.md')
    expect(result.normalized).toBe('process/QA.md')
    expect(result.wasNormalized).toBe(true)
  })

  it('strips shared/ prefix', () => {
    const result = normalizeArtifactPath('shared/process/QA.md')
    expect(result.normalized).toBe('process/QA.md')
    expect(result.wasNormalized).toBe(true)
  })

  it('rejects unknown absolute paths', () => {
    const result = normalizeArtifactPath('/etc/passwd')
    expect(result.rejected).toBe(true)
    expect(result.normalized).toBeNull()
    expect(result.rejectReason).toContain('Absolute path')
  })

  it('rejects paths with ..', () => {
    const result = normalizeArtifactPath('process/../../../etc/passwd')
    expect(result.rejected).toBe(true)
    expect(result.normalized).toBeNull()
  })

  it('rejects null bytes', () => {
    const result = normalizeArtifactPath('process/file\0.md')
    expect(result.rejected).toBe(true)
  })

  it('rejects empty string', () => {
    const result = normalizeArtifactPath('')
    expect(result.rejected).toBe(true)
  })

  it('passes through URLs unchanged', () => {
    const url = 'https://github.com/reflectt/reflectt-node/pull/341'
    const result = normalizeArtifactPath(url)
    expect(result.normalized).toBe(url)
    expect(result.rejected).toBe(false)
    expect(result.wasNormalized).toBe(false)
  })

  it('strips reflectt-node project prefix', () => {
    const result = normalizeArtifactPath('/Users/ryan/projects/reflectt-node/process/QA.md')
    expect(result.normalized).toBe('process/QA.md')
    expect(result.wasNormalized).toBe(true)
  })
})

describe('normalizeTaskArtifactPaths', () => {
  it('normalizes artifact_path in metadata', () => {
    const result = normalizeTaskArtifactPaths({
      artifact_path: '/Users/ryan/.openclaw/workspace-link/process/task-qa.md',
    })
    expect(result.patches.artifact_path).toBe('process/task-qa.md')
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.rejected).toHaveLength(0)
  })

  it('normalizes nested qa_bundle.review_packet.artifact_path', () => {
    const result = normalizeTaskArtifactPaths({
      qa_bundle: {
        review_packet: {
          artifact_path: 'workspace-shared/process/QA.md',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/1',
        },
      },
    })
    const patch = result.patches.qa_bundle as Record<string, unknown>
    const rp = patch?.review_packet as Record<string, unknown>
    expect(rp?.artifact_path).toBe('process/QA.md')
  })

  it('normalizes review_handoff.artifact_path', () => {
    const result = normalizeTaskArtifactPaths({
      review_handoff: {
        artifact_path: 'shared/process/TASK-123.md',
        pr_url: 'https://github.com/reflectt/reflectt-node/pull/1',
      },
    })
    const patch = result.patches.review_handoff as Record<string, unknown>
    expect(patch?.artifact_path).toBe('process/TASK-123.md')
  })

  it('does nothing for already-normalized paths', () => {
    const result = normalizeTaskArtifactPaths({
      artifact_path: 'process/clean-path.md',
    })
    expect(Object.keys(result.patches)).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('reports rejected paths', () => {
    const result = normalizeTaskArtifactPaths({
      artifact_path: '/etc/shadow',
    })
    expect(result.rejected.length).toBeGreaterThan(0)
  })
})

describe('buildGitHubBlobUrl', () => {
  it('builds correct blob URL from PR', () => {
    const url = buildGitHubBlobUrl(
      'https://github.com/reflectt/reflectt-node/pull/341',
      'abc1234',
      'process/task-qa.md',
    )
    expect(url).toBe('https://github.com/reflectt/reflectt-node/blob/abc1234/process/task-qa.md')
  })

  it('returns null for non-GitHub URLs', () => {
    expect(buildGitHubBlobUrl('https://gitlab.com/foo/bar/pull/1', 'abc1234', 'file.md')).toBeNull()
  })

  it('returns null for short commit SHAs', () => {
    expect(buildGitHubBlobUrl('https://github.com/o/r/pull/1', 'abc', 'file.md')).toBeNull()
  })
})

describe('buildGitHubRawUrl', () => {
  it('builds correct raw URL from PR', () => {
    const url = buildGitHubRawUrl(
      'https://github.com/reflectt/reflectt-node/pull/341',
      'abc1234',
      'process/task-qa.md',
    )
    expect(url).toBe('https://raw.githubusercontent.com/reflectt/reflectt-node/abc1234/process/task-qa.md')
  })
})
