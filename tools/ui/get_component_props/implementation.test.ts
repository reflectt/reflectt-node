import { describe, it, expect } from 'vitest'
import getComponentProps from './implementation'
import { createToolContext } from '@/lib/tools/helpers'

describe('getComponentProps', () => {
  const mockContext = createToolContext({
    currentSpace: 'test-space',
    globalDataDir: '/tmp/test-global',
    spaceDataDir: '/tmp/test-space'
  })

  describe('Happy Path', () => {
    it('should return props for query_results_table component', async () => {
      const result = await getComponentProps(
        { componentId: 'query_results_table', includeExamples: true },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.componentId).toBe('query_results_table')
        expect(result.componentName).toBe('Query Results Table')
        expect(result.category).toBe('data')
        expect(result.tags).toContain('table')
        expect(result.props).toBeDefined()
        expect(result.requiredProps).toBeDefined()
        expect(result.optionalProps).toBeDefined()
        expect(result.examples).toBeDefined()
        expect(result.examples!.length).toBeGreaterThan(0)
      }
    })

    it('should return props for portals:chart component', async () => {
      const result = await getComponentProps(
        { componentId: 'portals:chart', includeExamples: true },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.componentId).toBe('portals:chart')
        expect(result.category).toBe('visualization')
        expect(result.tags).toContain('chart')
        expect(result.props).toBeDefined()
        expect(result.examples).toBeDefined()
      }
    })

    it('should work without examples', async () => {
      const result = await getComponentProps(
        { componentId: 'query_results_table', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.examples).toBeUndefined()
      }
    })

    it('should include component capabilities', async () => {
      const result = await getComponentProps(
        { componentId: 'query_results_table', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.capabilities).toBeDefined()
        expect(result.capabilities?.interactive).toBe(true)
        expect(result.capabilities?.exportable).toBe(true)
      }
    })

    it('should include whenToUse and alternatives', async () => {
      const result = await getComponentProps(
        { componentId: 'query_results_table', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.whenToUse).toBeDefined()
        expect(result.alternatives).toBeDefined()
        expect(result.alternatives!.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Error Cases', () => {
    it('should return error for non-existent component', async () => {
      const result = await getComponentProps(
        { componentId: 'non_existent_component', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('not found')
        expect(result.suggestion).toBeDefined()
        expect(result.availableComponents).toBeDefined()
      }
    })

    it('should suggest similar components for typos', async () => {
      const result = await getComponentProps(
        { componentId: 'table', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.similarComponents).toBeDefined()
        expect(result.similarComponents!.length).toBeGreaterThan(0)
        // Should suggest query_results_table since it has 'table' tag
        expect(result.similarComponents).toContain('query_results_table')
      }
    })

    it('should suggest similar components for partial match', async () => {
      const result = await getComponentProps(
        { componentId: 'chart', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.similarComponents).toBeDefined()
        // Should suggest portals:chart
        expect(result.similarComponents).toContain('portals:chart')
      }
    })
  })

  describe('Prop Schema Extraction', () => {
    it('should extract required and optional props correctly', async () => {
      const result = await getComponentProps(
        { componentId: 'query_results_table', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        // columns and rows are required
        expect(result.requiredProps).toContain('columns')
        expect(result.requiredProps).toContain('rows')

        // title, description, pageSize are optional
        expect(result.optionalProps).toContain('title')
        expect(result.optionalProps).toContain('description')
        expect(result.optionalProps).toContain('pageSize')
      }
    })

    it('should extract prop types correctly', async () => {
      const result = await getComponentProps(
        { componentId: 'portals:chart', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        // title should be string
        if (result.props.title) {
          expect(result.props.title.type).toBe('string')
        }

        // height should be number
        if (result.props.height) {
          expect(result.props.height.type).toBe('number')
        }

        // dataset should be array
        if (result.props.dataset) {
          expect(result.props.dataset.type).toBe('array')
        }
      }
    })

    it('should extract default values', async () => {
      const result = await getComponentProps(
        { componentId: 'portals:chart', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        // height has default of 260
        if (result.props.height) {
          expect(result.props.height.default).toBe(260)
        }

        // variant has default of 'bar'
        if (result.props.variant) {
          expect(result.props.variant.default).toBe('bar')
        }
      }
    })

    it('should extract enum values', async () => {
      const result = await getComponentProps(
        { componentId: 'portals:chart', includeExamples: false },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        // variant should be an enum
        if (result.props.variant) {
          expect(result.props.variant.type).toBe('enum')
          expect(result.props.variant.enum).toBeDefined()
          expect(result.props.variant.enum).toContain('bar')
          expect(result.props.variant.enum).toContain('line')
          expect(result.props.variant.enum).toContain('area')
        }
      }
    })
  })

  describe('Examples', () => {
    it('should return example configurations', async () => {
      const result = await getComponentProps(
        { componentId: 'query_results_table', includeExamples: true },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success && result.examples) {
        expect(result.examples.length).toBeGreaterThan(0)

        // Each example should have required fields
        result.examples.forEach(example => {
          expect(example.description).toBeDefined()
          expect(example.useCase).toBeDefined()
          expect(example.props).toBeDefined()
          expect(typeof example.props).toBe('object')
        })
      }
    })

    it('should include props in examples', async () => {
      const result = await getComponentProps(
        { componentId: 'portals:chart', includeExamples: true },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success && result.examples) {
        // Should have at least one example with props
        const exampleWithProps = result.examples.find(ex =>
          ex.props && Object.keys(ex.props).length > 0
        )
        expect(exampleWithProps).toBeDefined()
      }
    })
  })
})
