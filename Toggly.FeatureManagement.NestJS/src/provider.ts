import { Injectable, Inject, type OnApplicationShutdown } from '@nestjs/common'
import { createTogglyClient, type TogglyClient } from '@ops-ai/toggly-node-core'
import { TOGGLY_OPTIONS, type TogglyModuleOptions } from './types.js'
/** One application-owned core client; never set its identity in request handlers. */
@Injectable()
export class TogglyProvider implements OnApplicationShutdown {
  readonly client: TogglyClient
  constructor(@Inject(TOGGLY_OPTIONS) options: TogglyModuleOptions) {
    const { contextFactory: _context, isGlobal: _global, ...config } = options
    this.client = createTogglyClient(config)
  }
  get state() { return this.client.state }
  async initialize(): Promise<void> {
    try { await this.client.init() }
    catch (error) { await this.client.close(); throw error }
  }
  async onApplicationShutdown(): Promise<void> { await this.client.close() }
}
