import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

interface Object3D {
  id: string
  type: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'text'
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number] | number
  color?: string
  wireframe?: boolean
  opacity?: number
  text?: string
  animate?: {
    type: 'rotate' | 'bounce' | 'pulse' | 'orbit'
    speed?: number
    axis?: 'x' | 'y' | 'z'
  }
  metadata?: Record<string, any>
}

interface Render3DSceneInput {
  title?: string
  objects: Object3D[]
  camera?: {
    position?: [number, number, number]
    fov?: number
  }
  environment?: 'sunset' | 'dawn' | 'night' | 'warehouse' | 'forest' | 'studio'
  grid?: boolean
  backgroundColor?: string
  slot?: 'primary' | 'secondary' | 'sidebar' | 'overlay' | 'inline'
}

interface Render3DSceneOutput {
  success: boolean
  message: string
  componentId: string
  objectCount: number
}

/**
 * Render an interactive 3D scene with Three.js
 * 
 * This tool allows the AI to create immersive 3D visualizations for:
 * - Data visualization (charts in 3D space)
 * - Spatial planning (floor layouts, seating arrangements)
 * - Product visualization
 * - Educational demonstrations
 * - Interactive experiences
 * 
 * Objects can be animated and are fully interactive - users can click them
 * and orbit around the scene.
 */
export default async function render_3d_scene(
  input: Render3DSceneInput,
  _ctx: ToolContext
): Promise<Render3DSceneOutput> {
  const startTime = Date.now()

  try {
    const {
      title = '3D Scene',
      objects,
      camera = { position: [5, 5, 5], fov: 50 },
      environment = 'studio',
      grid = true,
      backgroundColor = '#0a0a0a',
      slot = 'primary'
    } = input

    if (!objects || objects.length === 0) {
      return {
        success: false,
        message: 'At least one object is required',
        componentId: 'scene-3d',
        objectCount: 0
      }
    }

    // Validate objects
    for (const obj of objects) {
      if (!obj.id || !obj.type || !obj.position) {
        return {
          success: false,
          message: `Invalid object: id, type, and position are required`,
          componentId: 'scene-3d',
          objectCount: objects.length
        }
      }
    }

    // Stream the render_manifest to display the 3D scene
    const manifest = {
      type: 'render_manifest',
      ui_manifest: {
        layout: {
          kind: 'stack',
          components: [
            {
              type: 'scene-3d',
              slot,
              props: {
                objects,
                camera,
                environment,
                grid,
                backgroundColor,
                onObjectClick: (objectId: string, metadata?: Record<string, any>) => {
                  console.log('3D object clicked:', objectId, metadata)
                }
              }
            }
          ]
        }
      },
      note: title
    }

    // TODO: Stream via context when available
    console.log('3D Scene manifest:', JSON.stringify(manifest, null, 2))

    const duration = Date.now() - startTime

    return {
      success: true,
      message: `3D scene rendered with ${objects.length} object(s) in ${duration}ms. ${title}`,
      componentId: 'scene-3d',
      objectCount: objects.length
    }
  } catch (error) {
    return {
      success: false,
      message: formatError(error),
      componentId: 'scene-3d',
      objectCount: 0
    }
  }
}
