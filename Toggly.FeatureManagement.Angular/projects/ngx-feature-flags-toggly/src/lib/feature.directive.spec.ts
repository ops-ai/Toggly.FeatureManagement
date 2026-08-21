import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FeatureFlagDirective } from './feature.directive';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';
import { TogglyService } from './toggly.service';
import { clearRegisteredContexts } from '@ops-ai/toggly-hooks-types';

// Host component for structural directive testing
@Component({
  standalone: true,
  imports: [FeatureFlagDirective],
  template: `
    <div *featureFlag="flag; requirement: requirement; negate: negate">
      <span class="content">Feature Content</span>
    </div>
  `,
})
class DirectiveHostComponent {
  flag: string | string[] = '';
  requirement: 'all' | 'any' = 'all';
  negate = false;
}

describe('FeatureFlagDirective', () => {
  let fixture: ComponentFixture<DirectiveHostComponent>;
  let host: DirectiveHostComponent;

  function configureAndCreate(
    defaults: { [k: string]: boolean } = { Enabled: true, Disabled: false, A: true, B: true, C: false }
  ) {
    spyOn(console, 'warn');
    TestBed.configureTestingModule({
      imports: [DirectiveHostComponent, NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: defaults })],
    });
    fixture = TestBed.createComponent(DirectiveHostComponent);
    host = fixture.componentInstance;
  }

  describe('Single feature key', () => {
    it('should show content when feature is enabled', fakeAsync(() => {
      configureAndCreate();
      host.flag = 'Enabled';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));

    it('should hide content when feature is disabled', fakeAsync(() => {
      configureAndCreate();
      host.flag = 'Disabled';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));

    it('should hide content for unknown feature', fakeAsync(() => {
      configureAndCreate();
      host.flag = 'Unknown';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));
  });

  describe('Multiple feature keys (array)', () => {
    it('should show when all keys enabled', fakeAsync(() => {
      configureAndCreate();
      host.flag = ['A', 'B'];
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));

    it('should hide when some keys disabled (all)', fakeAsync(() => {
      configureAndCreate();
      host.flag = ['A', 'C'];
      host.requirement = 'all';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));

    it('should re-evaluate when requirement changes from all to any', fakeAsync(() => {
      configureAndCreate();
      host.flag = ['A', 'C'];
      host.requirement = 'all';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();

      host.requirement = 'any';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));

    it('should re-evaluate when negate changes', fakeAsync(() => {
      configureAndCreate();
      host.flag = 'Enabled';
      host.negate = false;
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();

      host.negate = true;
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));
  });

  describe('Requirement: any', () => {
    it('should show when any key enabled', fakeAsync(() => {
      configureAndCreate();
      host.flag = ['A', 'C'];
      host.requirement = 'any';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));

    it('should hide when none enabled', fakeAsync(() => {
      configureAndCreate();
      host.flag = ['C'];
      host.requirement = 'any';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));
  });

  describe('Negate', () => {
    it('should hide when enabled and negate true', fakeAsync(() => {
      configureAndCreate();
      host.flag = 'Enabled';
      host.negate = true;
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));

    it('should show when disabled and negate true', fakeAsync(() => {
      configureAndCreate();
      host.flag = 'Disabled';
      host.negate = true;
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));
  });

  describe('View lifecycle', () => {
    it('should not create duplicate views when already visible', fakeAsync(() => {
      configureAndCreate();
      host.flag = 'Enabled';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.content').length).toBe(1);

      // Re-trigger by changing input to same value (string -> array)
      host.flag = ['Enabled'];
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.content').length).toBe(1);
    }));

    it('should clear view when feature becomes disabled', fakeAsync(() => {
      configureAndCreate();
      host.flag = 'Enabled';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();

      host.flag = 'Disabled';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));
  });

  describe('Empty features', () => {
    it('should hide content when no features are available for a non-empty gate', fakeAsync(() => {
      configureAndCreate({});
      host.flag = 'Any';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));

    it('should show content when feature flag is cleared to empty', fakeAsync(() => {
      configureAndCreate();
      host.flag = '';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));
  });
});

@Component({
  standalone: true,
  imports: [FeatureFlagDirective],
  template: `
    <div *featureFlag="flag; context: context; kind: kind">
      <span class="badge">Badge</span>
    </div>
  `,
})
class ContextDirectiveHostComponent {
  flag = 'ShowBadge';
  context: { BirthDate: string } | null = { BirthDate: '2026-06-15T00:00:00Z' };
  kind = 'Puppy';
}

describe('FeatureFlagDirective entity context', () => {
  const datetimeGate = {
    requirement: 'all' as const,
    rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' as const }],
  };

  beforeEach(() => {
    clearRegisteredContexts();
  });

  afterEach(() => {
    clearRegisteredContexts();
  });

  it('should hide a gate without mapped context and show it after registerContext', fakeAsync(() => {
    spyOn(console, 'warn');
    TestBed.configureTestingModule({
      imports: [
        ContextDirectiveHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { ShowBadge: datetimeGate as any },
        }),
      ],
    });
    const fixture = TestBed.createComponent(ContextDirectiveHostComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.badge')).toBeNull();

    const service = TestBed.inject(TogglyService);
    service.registerContext('Puppy', (entity: { BirthDate: string }) => ({
      kind: 'Puppy',
      key: '1',
      attributes: { BirthDate: entity.BirthDate },
    }));
    fixture.componentInstance.context = { BirthDate: '2026-06-15T00:00:00Z' };
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.badge')).toBeTruthy();
  }));

  it('should treat a non-string non-array flag as an empty gate', fakeAsync(() => {
    spyOn(console, 'warn');
    TestBed.configureTestingModule({
      imports: [DirectiveHostComponent, NgxFeatureFlagsTogglyModule.forRoot({
        featureDefaults: { Enabled: true },
      })],
    });
    const fixture = TestBed.createComponent(DirectiveHostComponent);
    const host = fixture.componentInstance;
    host.flag = 1 as any;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
  }));
});
