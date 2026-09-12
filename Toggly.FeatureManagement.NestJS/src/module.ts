import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import {
  TOGGLY_OPTIONS,
  type TogglyModuleAsyncOptions,
  type TogglyModuleOptions,
} from './types.js';
import { TogglyProvider } from './provider.js';
import { TogglyService } from './service.js';
import { FeatureFlagGuard } from './guard.js';
import { FeatureEnabledPipe } from './decorators.js';

@Module({})
export class TogglyModule {
  /** Register one initialized core client and request-scoped evaluation providers. */
  static forRoot<Request = unknown>(options: TogglyModuleOptions<Request> = {}): DynamicModule {
    return this.register({ provide: TOGGLY_OPTIONS, useValue: options }, options.isGlobal);
  }

  /** Resolve configuration dependencies before initializing the singleton client. */
  static forRootAsync(options: TogglyModuleAsyncOptions): DynamicModule {
    return {
      ...this.register(
        { provide: TOGGLY_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        options.isGlobal,
        options.providers,
      ),
      imports: options.imports ?? [],
    };
  }

  private static register(
    options: Provider,
    global = false,
    extra: Provider[] = [],
  ): DynamicModule {
    return {
      module: TogglyModule,
      global,
      providers: [
        ...extra,
        options,
        {
          provide: TogglyProvider,
          inject: [TOGGLY_OPTIONS],
          useFactory: async (config: TogglyModuleOptions) => {
            const provider = new TogglyProvider(config);
            await provider.initialize();
            return provider;
          },
        },
        TogglyService,
        FeatureFlagGuard,
        FeatureEnabledPipe,
      ],
      exports: [TogglyProvider, TogglyService, FeatureFlagGuard, FeatureEnabledPipe],
    };
  }
}
