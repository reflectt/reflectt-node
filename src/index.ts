/**
 * reflectt-node - Local node server for agent communication via OpenClaw
 * 
 * Entry point
 */
import { createServer } from './server.js'
import { serverConfig } from './config.js'
// OpenClaw connection is optional — server works for chat/tasks without it

async function main() {
  console.log('🚀 Starting reflectt-node...')
  
  try {
    const app = await createServer()
    
    await app.listen({
      port: serverConfig.port,
      host: serverConfig.host,
    })

    console.log(`✅ Server running at http://${serverConfig.host}:${serverConfig.port}`)
    console.log(`   - REST API: http://${serverConfig.host}:${serverConfig.port}`)
    console.log(`   - WebSocket: ws://${serverConfig.host}:${serverConfig.port}/chat/ws`)
    console.log(`   - Health: http://${serverConfig.host}:${serverConfig.port}/health`)
    
    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down...`)
      // openclawClient.close()
      await app.close()
      process.exit(0)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
    
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

main()
