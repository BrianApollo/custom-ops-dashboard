import { httpServerHandler } from 'cloudflare:node'
import { app } from './app'
import { runNightly } from './executor/nightly'

// Cloudflare Workflows finds the class among the Worker's exports (wrangler.template.jsonc)
export { ImageGenerationWorkflow } from './generation/workflow'

const PORT = 3000

app.listen(PORT)

export default {
  ...httpServerHandler({ port: PORT }),
  async scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(runNightly())
  },
} satisfies ExportedHandler
