/**
 * Public-entry flag evaluation against the Toggly evaluated-signed /
 * evaluated-variants-signed API contract (mocked HTTP with realistic payloads).
 *
 * This client SDK consumes server-pre-evaluated flag maps; docs/filter-parity
 * fixtures and the variant-allocator corpus apply to local-eval SDKs, not here.
 */
import { Component } from '@angular/core'
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { FeatureFlagDirective } from './feature.directive'
import { FeatureVariantDirective } from './feature-variant.directive'
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module'
import { TogglyService } from './toggly.service'

function mockEvaluatedResponse(payload: unknown): jasmine.Spy {
  return spyOn(globalThis, 'fetch').and.resolveTo({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as any)
}

describe('evaluated-signed API contract evaluation', () => {
  beforeEach(() => {
    localStorage.clear()
    spyOn(console, 'warn').and.stub()
    spyOn(console, 'error').and.stub()
  })

  afterEach(() => {
    TestBed.resetTestingModule()
  })

  it('fetches evaluated-signed and evaluates wrapped defs map via public APIs', async () => {
    const fetchSpy = mockEvaluatedResponse({
      defs: {
        AlwaysOn: true,
        AlwaysOff: false,
        TargetingMatch: true,
        PercentageGate: false,
      },
    })

    TestBed.configureTestingModule({
      imports: [
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'contract-app',
          environment: 'Production',
          baseURI: 'https://definitions.example.test',
          identity: 'alice',
          groups: ['staff'],
          claims: { plan: 'pro' },
          enableTelemetry: false,
          persistCache: false,
          verifySignatures: false,
        }),
      ],
    })
    const service = TestBed.inject(TogglyService)

    expect(await service.isFeatureOn('AlwaysOn')).toBe(true)
    expect(await service.isFeatureOff('AlwaysOff')).toBe(true)
    expect(await service.isFeatureOn('TargetingMatch')).toBe(true)
    expect(await service.isFeatureOn('PercentageGate')).toBe(false)
    expect(await service.isFeatureOn('Missing')).toBe(false)

    expect(await service.evaluateFeatureGate(['AlwaysOn', 'AlwaysOff'], 'any')).toBe(true)
    expect(await service.evaluateFeatureGate(['AlwaysOn', 'AlwaysOff'], 'all')).toBe(false)

    expect(fetchSpy).toHaveBeenCalled()
    const calledUrl = String(fetchSpy.calls.mostRecent().args[0])
    expect(calledUrl).toContain('/evaluated-signed/contract-app/Production')
    expect(calledUrl).not.toContain('/definitions-signed/')
    expect(calledUrl).not.toContain('/evaluated-variants-signed/')
    const query = new URL(calledUrl).searchParams
    expect(query.get('u')).toBe('alice')
    expect(query.getAll('g')).toEqual(['staff'])
    expect(query.get('claim.plan')).toBe('pro')
  })

  it('accepts flat evaluated-signed FeatureFlags body (no defs wrapper)', async () => {
    mockEvaluatedResponse({
      FlagOn: true,
      FlagOff: false,
    })

    TestBed.configureTestingModule({
      imports: [
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'contract-app',
          environment: 'Production',
          baseURI: 'https://definitions.example.test',
          enableTelemetry: false,
          persistCache: false,
          verifySignatures: false,
        }),
      ],
    })
    const service = TestBed.inject(TogglyService)

    expect(await service.isFeatureOn('FlagOn')).toBe(true)
    expect(await service.isFeatureOn('FlagOff')).toBe(false)
    expect(await service.evaluateFeatureGate(['FlagOn', 'FlagOff'], 'any')).toBe(true)
  })

  it('re-evaluates after setContext forces a refresh with a new payload', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.and.resolveTo({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: () => Promise.resolve({ defs: { Flip: false } }),
      text: () => Promise.resolve(JSON.stringify({ defs: { Flip: false } })),
    } as any)

    TestBed.configureTestingModule({
      imports: [
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'contract-app',
          environment: 'Production',
          baseURI: 'https://definitions.example.test',
          enableTelemetry: false,
          persistCache: false,
          verifySignatures: false,
        }),
      ],
    })
    const service = TestBed.inject(TogglyService)
    expect(await service.isFeatureOn('Flip')).toBe(false)

    fetchSpy.and.resolveTo({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: () => Promise.resolve({ defs: { Flip: true } }),
      text: () => Promise.resolve(JSON.stringify({ defs: { Flip: true } })),
    } as any)
    await service.setContext({ identity: 'bob' })
    expect(await service.isFeatureOn('Flip')).toBe(true)
  })
})

describe('evaluated-variants-signed API contract evaluation', () => {
  beforeEach(() => {
    localStorage.clear()
    spyOn(console, 'warn').and.stub()
    spyOn(console, 'error').and.stub()
  })

  afterEach(() => {
    TestBed.resetTestingModule()
  })

  it('fetches evaluated-variants-signed and exposes variant public APIs', async () => {
    const fetchSpy = mockEvaluatedResponse({
      defs: {
        Sale: {
          enabled: true,
          variant: 'Treatment',
          configurationValue: { discount: 15 },
        },
        ControlOnly: {
          enabled: true,
          variant: 'Control',
          configurationValue: 'plain',
        },
        Disabled: {
          enabled: false,
          variant: 'Hidden',
          configurationValue: null,
        },
      },
    })

    TestBed.configureTestingModule({
      imports: [
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'contract-app',
          environment: 'Production',
          baseURI: 'https://definitions.example.test',
          enableTelemetry: false,
          persistCache: false,
          verifySignatures: false,
          enableVariants: true,
        }),
      ],
    })
    const service = TestBed.inject(TogglyService)

    expect(await service.isFeatureOn('Sale')).toBe(true)
    expect(await service.isFeatureOn('Disabled')).toBe(false)
    expect(await service.getVariant('Sale')).toEqual({
      name: 'Treatment',
      configurationValue: { discount: 15 },
    })
    expect(await service.getVariantValue<{ discount: number }>('Sale')).toEqual({
      discount: 15,
    })
    expect(await service.getVariantValue('ControlOnly')).toBe('plain')
    expect(await service.getVariant('Missing')).toBeNull()
    expect(await service.getVariant('Disabled')).toBeNull()

    const calledUrl = String(fetchSpy.calls.mostRecent().args[0])
    expect(calledUrl).toContain('/evaluated-variants-signed/contract-app/Production')
    expect(calledUrl).not.toContain('/evaluated-signed/contract-app')
  })
})

@Component({
  standalone: true,
  imports: [FeatureFlagDirective],
  template: `
    <div *featureFlag="'AlwaysOn'"><span class="on">on</span></div>
    <div *featureFlag="'AlwaysOff'"><span class="off">off</span></div>
  `,
})
class EvaluatedSignedDirectiveHostComponent {}

@Component({
  standalone: true,
  imports: [FeatureVariantDirective],
  template: `
    <div *featureVariant="'Sale'; variant: 'Treatment'"><span class="treatment">treatment</span></div>
    <div *featureVariant="'Sale'; variant: 'Control'"><span class="control">control</span></div>
  `,
})
class EvaluatedVariantsDirectiveHostComponent {}

describe('evaluated-signed API contract directive rendering', () => {
  beforeEach(() => {
    localStorage.clear()
    spyOn(console, 'warn').and.stub()
    spyOn(console, 'error').and.stub()
  })

  afterEach(() => {
    TestBed.resetTestingModule()
  })

  it('renders *featureFlag from an evaluated-signed defs payload', fakeAsync(() => {
    mockEvaluatedResponse({
      defs: {
        AlwaysOn: true,
        AlwaysOff: false,
      },
    })

    TestBed.configureTestingModule({
      imports: [
        EvaluatedSignedDirectiveHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'contract-app',
          environment: 'Production',
          baseURI: 'https://definitions.example.test',
          enableTelemetry: false,
          persistCache: false,
          verifySignatures: false,
        }),
      ],
    })

    const fixture: ComponentFixture<EvaluatedSignedDirectiveHostComponent> =
      TestBed.createComponent(EvaluatedSignedDirectiveHostComponent)
    fixture.detectChanges()
    tick()
    fixture.detectChanges()

    expect(fixture.nativeElement.querySelector('.on')).toBeTruthy()
    expect(fixture.nativeElement.querySelector('.off')).toBeNull()
  }))
})

describe('evaluated-variants-signed API contract directive rendering', () => {
  beforeEach(() => {
    localStorage.clear()
    spyOn(console, 'warn').and.stub()
    spyOn(console, 'error').and.stub()
  })

  afterEach(() => {
    TestBed.resetTestingModule()
  })

  it('renders *featureVariant from an evaluated-variants-signed defs payload', fakeAsync(() => {
    mockEvaluatedResponse({
      defs: {
        Sale: {
          enabled: true,
          variant: 'Treatment',
          configurationValue: { discount: 15 },
        },
      },
    })

    TestBed.configureTestingModule({
      imports: [
        EvaluatedVariantsDirectiveHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'contract-app',
          environment: 'Production',
          baseURI: 'https://definitions.example.test',
          enableTelemetry: false,
          persistCache: false,
          verifySignatures: false,
          enableVariants: true,
        }),
      ],
    })

    const fixture: ComponentFixture<EvaluatedVariantsDirectiveHostComponent> =
      TestBed.createComponent(EvaluatedVariantsDirectiveHostComponent)
    fixture.detectChanges()
    tick()
    fixture.detectChanges()

    expect(fixture.nativeElement.querySelector('.treatment')).toBeTruthy()
    expect(fixture.nativeElement.querySelector('.control')).toBeNull()
  }))
})
