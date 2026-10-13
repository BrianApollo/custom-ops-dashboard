import { httpServerHandler } from 'cloudflare:node'
import { app } from './app'

const PORT = 3000

app.listen(PORT)

export default httpServerHandler({ port: PORT })
