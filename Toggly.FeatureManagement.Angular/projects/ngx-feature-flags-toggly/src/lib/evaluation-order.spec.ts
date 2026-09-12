import { ChangeDetectorRef, EmbeddedViewRef, TemplateRef, ViewContainerRef } from '@angular/core';
import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { FeatureComponent } from './feature.component';
import { FeatureFlagDirective } from './feature.directive';
import { FeatureGateBuilderDirective } from './feature-gate-builder.directive';
import { FeatureVariantDirective } from './feature-variant.directive';
import { TogglyService } from './toggly.service';

type Renderer = 'component' | 'flag' | 'builder' | 'variant';

function createRenderer(kind: Renderer) {
  const completions: Array<(enabled: boolean) => void> = [];
  let refresh = () => {};
  let localChange = () => {};
  const evaluate = () => new Promise<boolean>(resolve => completions.push(resolve));
  const service = {
    shouldShowFeatureDuringEvaluation: false,
    evaluateFeatureGate: evaluate,
    getVariant: () => evaluate().then(enabled => enabled ? { name: 'control' } : null),
    subscribeFeaturesRefresh: (callback: () => void) => {
      refresh = callback;
      return () => { refresh = () => {}; };
    },
    subscribeLocalGatesChanged: (callback: () => void) => {
      localChange = callback;
      return () => { localChange = () => {}; };
    },
  } as unknown as TogglyService;
  const markForCheck = jasmine.createSpy('markForCheck');
  const detector = { markForCheck } as unknown as ChangeDetectorRef;
  let rendered = false;
  const view = { context: { $implicit: false, enabled: false }, markForCheck };
  const container = {
    createEmbeddedView: (_template: unknown, context?: typeof view.context) => {
      rendered = true;
      if (context) view.context = context;
      return view as unknown as EmbeddedViewRef<typeof view.context>;
    },
    clear: () => { rendered = false; },
  } as unknown as ViewContainerRef;
  const template = {} as TemplateRef<typeof view.context>;
  const component = new FeatureComponent(service, detector);
  const flag = new FeatureFlagDirective(template, container, service, detector);
  const builder = new FeatureGateBuilderDirective(template, container, service, detector);
  const variant = new FeatureVariantDirective(template, container, service, detector);
  variant.variant = 'control';
  const instance = { component, flag, builder, variant }[kind];
  const setKey = (key: string) => {
    if (kind === 'component') { component.featureKey = key; component.ngOnChanges({}); }
    if (kind === 'flag') flag.featureFlag = key;
    if (kind === 'builder') builder.featureGateBuilder = key;
    if (kind === 'variant') { variant.featureVariant = key; variant.ngOnChanges({}); }
  };
  setKey('Checkout');
  instance.ngOnInit();
  return {
    completions, component, markForCheck, setKey,
    refresh: () => refresh(), localChange: () => localChange(),
    visible: () => kind === 'component' ? component.shouldShow : kind === 'builder' ? rendered && view.context.enabled : rendered,
    destroy: () => instance.ngOnDestroy(),
  };
}

for (const kind of ['component', 'flag', 'builder', 'variant'] as const) {
  describe(`${kind} evaluation ordering`, () => {
    for (const trigger of ['input', 'refresh', 'local gates'] as const) {
      for (const latest of [false, true]) {
        it(`keeps the latest ${trigger} result ${latest} when startup completes last`, fakeAsync(() => {
          const renderer = createRenderer(kind);
          const startup = renderer.completions.splice(0);
          if (trigger === 'input') renderer.setKey('Changed');
          if (trigger === 'refresh') renderer.refresh();
          if (trigger === 'local gates') renderer.localChange();
          expect(renderer.completions.length).toBe(1);
          renderer.completions[0](latest);
          flushMicrotasks();
          expect(renderer.visible()).toBe(latest);
          for (const finish of startup) finish(!latest);
          flushMicrotasks();
          expect(renderer.visible()).toBe(latest);
          renderer.destroy();
        }));
      }
    }
    it('ignores pending completions after destruction', fakeAsync(() => {
      const renderer = createRenderer(kind);
      renderer.destroy();
      renderer.markForCheck.calls.reset();
      for (const finish of renderer.completions) finish(true);
      flushMicrotasks();
      expect(renderer.visible()).toBe(false);
      expect(renderer.markForCheck).not.toHaveBeenCalled();
    }));
  });
}

it('keeps component loading until the latest evaluation completes', fakeAsync(() => {
  const renderer = createRenderer('component');
  renderer.setKey('Changed');
  renderer.completions[0](true);
  flushMicrotasks();
  expect(renderer.component.isLoading).toBe(true);
  expect(renderer.visible()).toBe(false);
  renderer.completions[1](false);
  flushMicrotasks();
  expect(renderer.component.isLoading).toBe(false);
  renderer.destroy();
}));

for (const kind of ['component', 'builder', 'variant'] as const) {
  it(`${kind} invalidates pending evaluation when its input becomes empty`, fakeAsync(() => {
    const renderer = createRenderer(kind);
    renderer.setKey('');
    const expected = kind !== 'variant';
    expect(renderer.visible()).toBe(expected);
    for (const finish of renderer.completions) finish(!expected);
    flushMicrotasks();
    expect(renderer.visible()).toBe(expected);
    renderer.destroy();
  }));
}
