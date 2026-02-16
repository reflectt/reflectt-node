import { beforeEach, describe, expect, it, vi } from 'vitest'

const pipelineMock = vi.fn()

vi.mock('@xenova/transformers', () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}))

describe('embeddings (mocked)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../src/embeddings.js')
    mod.resetEmbeddingCacheForTests()
  })

  it('lazy-loads model and embeds single text', async () => {
    const extractor = vi.fn(async () => ({ data: new Float32Array([0.1, 0.2, 0.3]) }))
    pipelineMock.mockResolvedValue(extractor)

    const mod = await import('../src/embeddings.js')

    const vec = await mod.embed('hello world')

    expect(vec).toBeInstanceOf(Float32Array)
    expect(Array.from(vec)[0]).toBeCloseTo(0.1, 5)
    expect(Array.from(vec)[1]).toBeCloseTo(0.2, 5)
    expect(Array.from(vec)[2]).toBeCloseTo(0.3, 5)
    expect(pipelineMock).toHaveBeenCalledTimes(1)
    expect(pipelineMock).toHaveBeenCalledWith('feature-extraction', mod.embeddingModelId())

    // cache hit: second call should not reload pipeline
    await mod.embed('another sentence')
    expect(pipelineMock).toHaveBeenCalledTimes(1)
  })

  it('supports batch embeddings and preserves order', async () => {
    const extractor = vi.fn(async () => [
      { data: new Float32Array([1, 0]) },
      { data: new Float32Array([0, 1]) },
    ])
    pipelineMock.mockResolvedValue(extractor)

    const mod = await import('../src/embeddings.js')
    const out = await mod.embedBatch(['alpha', 'beta'])

    expect(out).toHaveLength(2)
    expect(Array.from(out[0])).toEqual([1, 0])
    expect(Array.from(out[1])).toEqual([0, 1])
    expect(extractor).toHaveBeenCalledWith(['alpha', 'beta'], { pooling: 'mean', normalize: true })
  })

  it('db helpers delegate to embedding module', async () => {
    const extractor = vi.fn(async () => ({ data: new Float32Array([0.5, 0.5]) }))
    pipelineMock.mockResolvedValue(extractor)

    const { embedTextForDb, embedBatchForDb } = await import('../src/db.js')
    const single = await embedTextForDb('db one')
    const batch = await embedBatchForDb(['db two'])

    expect(Array.from(single)).toEqual([0.5, 0.5])
    expect(batch).toHaveLength(1)
    expect(Array.from(batch[0])).toEqual([0.5, 0.5])
  })
})

describe('embeddings (real smoke)', () => {
  const shouldRun = process.env.RUN_REAL_EMBEDDING_TESTS === '1'

  it.skipIf(!shouldRun)('generates a real vector with transformers.js model', async () => {
    vi.resetModules()
    vi.doUnmock('@xenova/transformers')

    const mod = await import('../src/embeddings.js')
    mod.resetEmbeddingCacheForTests()

    const vec = await mod.embed('reflectt host heartbeat drift check')

    expect(vec).toBeInstanceOf(Float32Array)
    expect(vec.length).toBeGreaterThan(100)
  })
})
