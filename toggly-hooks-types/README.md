# @ops-ai/toggly-hooks-types

TypeScript types for Toggly SDK hooks. This package provides the core interfaces for implementing hooks in Toggly SDKs.

## Installation

```bash
npm install @ops-ai/toggly-hooks-types
```

## Usage

```typescript
import type { Hook, HookMetadata, EvaluationSeriesData } from '@ops-ai/toggly-hooks-types';

class MyCustomHook implements Hook {
  getMetadata(): HookMetadata {
    return { name: 'my-custom-hook' };
  }

  afterEvaluation(flagKey: string, data: EvaluationSeriesData | void, result: boolean): void {
    console.log(`Feature "${flagKey}" evaluated to ${result}`);
  }
}
```

## Hook Interface

```typescript
interface Hook {
  getMetadata(): HookMetadata;
  beforeEvaluation?(flagKey: string, defaultValue?: boolean): EvaluationSeriesData | void;
  afterEvaluation?(flagKey: string, data: EvaluationSeriesData | void, result: boolean): void;
  beforeIdentify?(identity: string): IdentitySeriesData | void;
  afterIdentify?(identity: string, data: IdentitySeriesData | void): void;
  afterRefresh?(flags: { [key: string]: boolean }): void;
}
```

## Hook Stages

- **beforeEvaluation**: Called before feature flag evaluation
- **afterEvaluation**: Called after feature flag evaluation with the result
- **beforeIdentify**: Called before setting or changing user identity
- **afterIdentify**: Called after identity has been set or changed
- **afterRefresh**: Called when flags are refreshed from the server

## License

MIT
