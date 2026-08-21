import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FeatureGateBuilderDirective } from './feature-gate-builder.directive';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';
import { TogglyService } from './toggly.service';
import { clearRegisteredContexts } from '@ops-ai/toggly-hooks-types';

@Component({
  standalone: true,
  imports: [FeatureGateBuilderDirective],
  template: `
    <button
      *featureGateBuilder="flag; requirement: requirement; negate: negate; let enabled"
      [class.active]="enabled"
    >
      Checkout
    </button>
  `,
})
class BuilderHostComponent {
  flag: string | string[] = ['Enabled', 'Disabled'];
  requirement: 'all' | 'any' = 'all';
  negate = false;
}

describe('FeatureGateBuilderDirective', () => {
  let fixture: ComponentFixture<BuilderHostComponent>;
  let host: BuilderHostComponent;

  beforeEach(() => {
    spyOn(console, 'warn');
    TestBed.configureTestingModule({
      imports: [
        BuilderHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { Enabled: true, Disabled: false },
        }),
      ],
    });
    fixture = TestBed.createComponent(BuilderHostComponent);
    host = fixture.componentInstance;
  });

  it('should always render template and expose enabled=true', fakeAsync(() => {
    host.flag = 'Enabled';
    host.requirement = 'all';
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button).toBeTruthy();
    expect(button.classList.contains('active')).toBe(true);
  }));

  it('should expose enabled=false when feature is disabled', fakeAsync(() => {
    host.flag = 'Disabled';
    host.requirement = 'all';
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button).toBeTruthy();
    expect(button.classList.contains('active')).toBe(false);
  }));

  it('should re-evaluate when featureGateBuilderRequirement changes', fakeAsync(() => {
    host.flag = ['Enabled', 'Disabled'];
    host.requirement = 'all';
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    let button = fixture.nativeElement.querySelector('button');
    expect(button.classList.contains('active')).toBe(false);

    host.requirement = 'any';
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    button = fixture.nativeElement.querySelector('button');
    expect(button.classList.contains('active')).toBe(true);
  }));

  it('should re-evaluate when negate changes', fakeAsync(() => {
    host.flag = 'Enabled';
    host.negate = false;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    let button = fixture.nativeElement.querySelector('button');
    expect(button.classList.contains('active')).toBe(true);

    host.negate = true;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    button = fixture.nativeElement.querySelector('button');
    expect(button.classList.contains('active')).toBe(false);
  }));

  it('should expose enabled=true for empty gate when not negated', fakeAsync(() => {
    host.flag = '';
    host.negate = false;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.classList.contains('active')).toBe(true);
  }));

  it('should expose enabled=false for empty gate when negated', fakeAsync(() => {
    host.flag = '';
    host.negate = true;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.classList.contains('active')).toBe(false);
  }));
});

@Component({
  standalone: true,
  imports: [FeatureGateBuilderDirective],
  template: `
    <button
      *featureGateBuilder="flag; context: context; kind: kind; let enabled"
      [class.active]="enabled"
    >
      Badge
    </button>
  `,
})
class ContextBuilderHostComponent {
  flag = 'ShowBadge';
  context: { BirthDate: string } = { BirthDate: '2026-06-15T00:00:00Z' };
  kind = 'Puppy';
}

describe('FeatureGateBuilderDirective entity context', () => {
  beforeEach(() => {
    clearRegisteredContexts();
  });

  afterEach(() => {
    clearRegisteredContexts();
  });

  it('should expose enabled after a mapped entity context is registered', fakeAsync(() => {
    spyOn(console, 'warn');
    const datetimeGate = {
      requirement: 'all' as const,
      rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' as const }],
    };
    TestBed.configureTestingModule({
      imports: [
        ContextBuilderHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { ShowBadge: datetimeGate as any },
        }),
      ],
    });
    const fixture = TestBed.createComponent(ContextBuilderHostComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').classList.contains('active')).toBe(false);

    TestBed.inject(TogglyService).registerContext('Puppy', (entity: { BirthDate: string }) => ({
      kind: 'Puppy',
      key: '1',
      attributes: { BirthDate: entity.BirthDate },
    }));
    fixture.componentInstance.context = { BirthDate: '2026-06-15T00:00:00Z' };
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').classList.contains('active')).toBe(true);
  }));

  it('should treat a non-string non-array builder flag as an empty gate', fakeAsync(() => {
    spyOn(console, 'warn');
    TestBed.configureTestingModule({
      imports: [
        BuilderHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { Enabled: true },
        }),
      ],
    });
    const fixture = TestBed.createComponent(BuilderHostComponent);
    fixture.componentInstance.flag = 1 as any;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    TestBed.inject(TogglyService).notifyLocalGatesChanged();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').classList.contains('active')).toBe(true);
  }));
});
