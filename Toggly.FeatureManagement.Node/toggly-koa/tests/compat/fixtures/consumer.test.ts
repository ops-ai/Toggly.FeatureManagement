import Koa from 'koa'
import { featureGate, togglyMiddleware, type TogglyKoaConfig } from '@ops-ai/toggly-koa'

const config: TogglyKoaConfig = {
  appKey: 'packed-host',
  getIdentity: (ctx) => ctx.get('x-toggly-identity'),
}

const app = new Koa()
app.use(togglyMiddleware(config))
app.use(featureGate({ featureKey: 'enabled' }))
