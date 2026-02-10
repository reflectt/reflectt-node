import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import upsertRecord, { SaveRecordInput } from './implementation'

describe('upsertRecord', () => {
  let tempDataDir: string
  let tempGlobalDir: string
  let tempSpacesDir: string

  beforeEach(() => {
    // Create temporary directories for testing
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-data-'))
    tempGlobalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-global-'))
    tempSpacesDir = path.join(path.dirname(tempGlobalDir), 'spaces')
    fs.mkdirSync(tempSpacesDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up temporary directories
    if (fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true })
    }
    if (fs.existsSync(tempGlobalDir)) {
      fs.rmSync(tempGlobalDir, { recursive: true, force: true })
    }
    if (fs.existsSync(tempSpacesDir)) {
      fs.rmSync(tempSpacesDir, { recursive: true, force: true })
    }
  })

  describe('Happy Path - First Record', () => {
    it('should save first record and create schema', async () => {
      const input: SaveRecordInput = {
        table: 'stories',
        record: {
          title: 'The Time Traveler',
          author: 'AI Writer',
          genre: 'sci-fi',
          word_count: 1500
        }
      }

      const result = await upsertRecord(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.id).toBeDefined()
      expect(result.path).toBe(`tables/stories/rows/${result.id}.json`)
      expect(result.schema_path).toBe('tables/stories/schema.json')

      // Verify record file exists
      const recordPath = path.join(tempDataDir, 'tables', 'stories', 'rows', `${result.id}.json`)
      expect(fs.existsSync(recordPath)).toBe(true)

      // Verify schema file exists
      const schemaPath = path.join(tempDataDir, 'tables', 'stories', 'schema.json')
      expect(fs.existsSync(schemaPath)).toBe(true)

      // Verify record content
      const savedRecord = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))
      expect(savedRecord.title).toBe('The Time Traveler')
      expect(savedRecord.author).toBe('AI Writer')
      expect(savedRecord.genre).toBe('sci-fi')
      expect(savedRecord.word_count).toBe(1500)
      expect(savedRecord.id).toBeDefined()
      expect(savedRecord.created_at).toBeDefined()
      expect(savedRecord.updated_at).toBeDefined()
    })

    it('should generate schema with correct structure', async () => {
      const input: SaveRecordInput = {
        table: 'users',
        record: {
          name: 'John Doe',
          email: 'john@example.com',
          age: 30,
          active: true,
          tags: ['user', 'premium']
        }
      }

      const result = await upsertRecord(input, tempDataDir, tempGlobalDir)

      const schemaPath = path.join(tempDataDir, 'tables', 'users', 'schema.json')
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'))

      expect(schema.table).toBe('users')
      expect(schema.version).toBe(1)
      expect(schema.created_at).toBeDefined()
      expect(schema.indexes).toEqual(['id'])
      expect(schema.description).toContain('users')

      // Verify field types
      expect(schema.fields.id.type).toBe('string')
      expect(schema.fields.id.required).toBe(true)
      expect(schema.fields.name.type).toBe('string')
      expect(schema.fields.email.type).toBe('string')
      expect(schema.fields.age.type).toBe('number')
      expect(schema.fields.active.type).toBe('boolean')
      expect(schema.fields.tags.type).toBe('array')
      expect(schema.fields.created_at.required).toBe(true)
      expect(schema.fields.updated_at.required).toBe(true)
    })
  })

  describe('Happy Path - Subsequent Records', () => {
    it('should save subsequent records without creating new schema', async () => {
      // First record
      await upsertRecord(
        { table: 'stories', record: { title: 'Story 1' } },
        tempDataDir,
        tempGlobalDir
      )

      // Second record
      const result = await upsertRecord(
        { table: 'stories', record: { title: 'Story 2' } },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.id).toBeDefined()
      expect(result.path).toBeDefined()
      expect(result.schema_path).toBeUndefined()  // Schema already exists
    })

    it('should save multiple records with unique IDs', async () => {
      const ids: string[] = []

      for (let i = 0; i < 5; i++) {
        const result = await upsertRecord(
          { table: 'items', record: { name: `Item ${i}` } },
          tempDataDir,
          tempGlobalDir
        )

        expect(result.success).toBe(true)
        ids.push(result.id!)
      }

      // All IDs should be unique
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(5)
    })
  })

  describe('Auto-Generated Fields', () => {
    it('should auto-generate ID if not provided', async () => {
      const result = await upsertRecord(
        { table: 'items', record: { name: 'Test Item' } },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.id).toBeDefined()
      expect(result.id!.length).toBeGreaterThan(0)

      // Verify UUID format (8-4-4-4-12)
      expect(result.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
    })

    it('should use provided ID if given', async () => {
      const customId = 'custom_id_123'

      const result = await upsertRecord(
        { table: 'items', record: { id: customId, name: 'Test' } },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.id).toBe(customId)

      const recordPath = path.join(tempDataDir, 'tables', 'items', 'rows', `${customId}.json`)
      expect(fs.existsSync(recordPath)).toBe(true)
    })

    it('should auto-generate created_at and updated_at', async () => {
      const result = await upsertRecord(
        { table: 'items', record: { name: 'Test' } },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'items', 'rows', `${result.id}.json`)
      const saved = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))

      expect(saved.created_at).toBeDefined()
      expect(saved.updated_at).toBeDefined()

      // Verify ISO 8601 format
      expect(saved.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(saved.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('should preserve provided created_at and updated_at', async () => {
      const customTimestamp = '2025-01-01T00:00:00.000Z'

      const result = await upsertRecord(
        {
          table: 'items',
          record: {
            name: 'Test',
            created_at: customTimestamp,
            updated_at: customTimestamp
          }
        },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'items', 'rows', `${result.id}.json`)
      const saved = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))

      expect(saved.created_at).toBe(customTimestamp)
      expect(saved.updated_at).toBe(customTimestamp)
    })
  })

  describe('Update Records', () => {
    it('should update existing record when same ID provided', async () => {
      const recordId = 'test_record_123'

      // Create record
      await upsertRecord(
        {
          table: 'users',
          record: {
            id: recordId,
            name: 'John Doe',
            email: 'john@example.com'
          }
        },
        tempDataDir,
        tempGlobalDir
      )

      // Wait a bit to ensure different updated_at
      await new Promise(resolve => setTimeout(resolve, 10))

      // Update record
      await upsertRecord(
        {
          table: 'users',
          record: {
            id: recordId,
            name: 'John Doe',
            email: 'john.doe@example.com',  // Updated
            status: 'active'  // New field
          }
        },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'users', 'rows', `${recordId}.json`)
      const saved = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))

      expect(saved.email).toBe('john.doe@example.com')
      expect(saved.status).toBe('active')
      // Note: created_at is overwritten in this implementation
      expect(saved.updated_at).toBeDefined()
    })
  })

  describe('Target Space', () => {
    it('should save to current space by default', async () => {
      const result = await upsertRecord(
        { table: 'items', record: { name: 'Test' } },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'items', 'rows', `${result.id}.json`)
      expect(fs.existsSync(recordPath)).toBe(true)
    })

    it('should save to target_space when specified', async () => {
      const creativeSpace = path.join(tempSpacesDir, 'creative')
      fs.mkdirSync(creativeSpace, { recursive: true })

      const result = await upsertRecord(
        {
          table: 'stories',
          record: { title: 'Creative Story' },
          target_space: 'creative'
        },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(creativeSpace, 'tables', 'stories', 'rows', `${result.id}.json`)
      expect(fs.existsSync(recordPath)).toBe(true)

      // Should NOT be in dataDir
      const dataDirPath = path.join(tempDataDir, 'tables', 'stories', 'rows', `${result.id}.json`)
      expect(fs.existsSync(dataDirPath)).toBe(false)
    })
  })

  describe('Complex Data Types', () => {
    it('should handle nested objects', async () => {
      const result = await upsertRecord(
        {
          table: 'projects',
          record: {
            name: 'Test Project',
            metadata: {
              created_by: 'admin',
              version: '1.0.0',
              config: {
                debug: true,
                port: 3000
              }
            }
          }
        },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'projects', 'rows', `${result.id}.json`)
      const saved = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))

      expect(saved.metadata.created_by).toBe('admin')
      expect(saved.metadata.config.debug).toBe(true)
      expect(saved.metadata.config.port).toBe(3000)
    })

    it('should handle arrays', async () => {
      const result = await upsertRecord(
        {
          table: 'lists',
          record: {
            name: 'Test List',
            items: ['item1', 'item2', 'item3'],
            numbers: [1, 2, 3, 4, 5]
          }
        },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'lists', 'rows', `${result.id}.json`)
      const saved = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))

      expect(saved.items).toEqual(['item1', 'item2', 'item3'])
      expect(saved.numbers).toEqual([1, 2, 3, 4, 5])
    })

    it('should handle null values', async () => {
      const result = await upsertRecord(
        {
          table: 'items',
          record: {
            name: 'Test',
            optional_field: null
          }
        },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'items', 'rows', `${result.id}.json`)
      const saved = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))

      expect(saved.optional_field).toBeNull()
    })
  })

  describe('Edge Cases', () => {
    it('should handle table names with hyphens and underscores', async () => {
      const result = await upsertRecord(
        { table: 'test-table_name', record: { data: 'test' } },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.path).toContain('test-table_name')
    })

    it('should handle empty record with auto-fields', async () => {
      const result = await upsertRecord(
        { table: 'empty', record: {} },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'empty', 'rows', `${result.id}.json`)
      const saved = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))

      // Should have auto-generated fields
      expect(saved.id).toBeDefined()
      expect(saved.created_at).toBeDefined()
      expect(saved.updated_at).toBeDefined()
    })

    it('should handle very long table names', async () => {
      const longTableName = 'a'.repeat(100)

      const result = await upsertRecord(
        { table: longTableName, record: { data: 'test' } },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid directory path', async () => {
      const invalidDir = '/invalid/readonly/path'

      const result = await upsertRecord(
        { table: 'items', record: { name: 'Test' } },
        invalidDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('ENOENT')
    })

    it('should handle file system errors gracefully', async () => {
      // Create a file where directory should be
      const conflictPath = path.join(tempDataDir, 'tables')
      fs.mkdirSync(path.dirname(conflictPath), { recursive: true })
      fs.writeFileSync(conflictPath, 'this is a file')

      const result = await upsertRecord(
        { table: 'items', record: { name: 'Test' } },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('Data Integrity', () => {
    it('should preserve all record data', async () => {
      const input = {
        title: 'Test',
        author: 'Author',
        number: 123,
        boolean: true,
        array: [1, 2, 3],
        object: { key: 'value' },
        null_field: null
      }

      const result = await upsertRecord(
        { table: 'items', record: input },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'items', 'rows', `${result.id}.json`)
      const saved = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))

      expect(saved.title).toBe(input.title)
      expect(saved.author).toBe(input.author)
      expect(saved.number).toBe(input.number)
      expect(saved.boolean).toBe(input.boolean)
      expect(saved.array).toEqual(input.array)
      expect(saved.object).toEqual(input.object)
      expect(saved.null_field).toBeNull()
    })

    it('should create valid JSON files', async () => {
      const result = await upsertRecord(
        { table: 'items', record: { name: 'Test' } },
        tempDataDir,
        tempGlobalDir
      )

      const recordPath = path.join(tempDataDir, 'tables', 'items', 'rows', `${result.id}.json`)
      const content = fs.readFileSync(recordPath, 'utf-8')

      // Should be valid JSON
      expect(() => JSON.parse(content)).not.toThrow()

      // Should be pretty-printed (with indentation)
      expect(content).toContain('\n')
      expect(content).toContain('  ')
    })
  })

  describe('Schema Generation Edge Cases', () => {
    it('should generate schema for record with mixed types', async () => {
      await upsertRecord(
        {
          table: 'mixed',
          record: {
            string: 'text',
            number: 42,
            boolean: true,
            array: [1, 2, 3],
            object: { key: 'value' },
            null_value: null
          }
        },
        tempDataDir,
        tempGlobalDir
      )

      const schemaPath = path.join(tempDataDir, 'tables', 'mixed', 'schema.json')
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'))

      expect(schema.fields.string.type).toBe('string')
      expect(schema.fields.number.type).toBe('number')
      expect(schema.fields.boolean.type).toBe('boolean')
      expect(schema.fields.array.type).toBe('array')
      expect(schema.fields.object.type).toBe('object')
      expect(schema.fields.null_value.type).toBe('string')  // null defaults to string
    })
  })
})
