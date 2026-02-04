import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FeatureComponent } from './feature.component';
import { FeatureTemplateDirective } from './feature-template.directive';
import { TogglyService } from './toggly.service';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';

// Host component for testing feature component with content projection
@Component({
  standalone: true,
  imports: [FeatureComponent, FeatureTemplateDirective],
  template: `
    <feature [featureKey]="featureKey" [featureKeys]="featureKeys"
             [requirement]="requirement" [negate]="negate">
      <ng-template featureTemplate>
        <span class="content">Visible</span>
      </ng-template>
    </feature>
  `,
})
class TestHostComponent {
  featureKey: string | undefined;
  featureKeys: string[] | undefined;
  requirement: 'all' | 'any' = 'all';
  negate = false;
}

describe('FeatureComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  function configureAndCreate(config: any = { featureDefaults: { Enabled: true, Disabled: false, A: true, B: true, C: false } }) {
    spyOn(console, 'warn');
    TestBed.configureTestingModule({
      imports: [TestHostComponent, NgxFeatureFlagsTogglyModule.forRoot(config)],
    });
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
  }

  describe('Basic rendering', () => {
    it('should create', () => {
      configureAndCreate();
      fixture.detectChanges();
      expect(host).toBeTruthy();
    });

    it('should render slot when feature is enabled', fakeAsync(() => {
      configureAndCreate();
      host.featureKey = 'Enabled';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));

    it('should not render when feature is disabled', fakeAsync(() => {
      configureAndCreate();
      host.featureKey = 'Disabled';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));

    it('should not render for unknown feature', fakeAsync(() => {
      configureAndCreate();
      host.featureKey = 'Unknown';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));
  });

  describe('featureKeys prop', () => {
    it('should render when all keys enabled', fakeAsync(() => {
      configureAndCreate();
      host.featureKeys = ['A', 'B'];
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));

    it('should not render when some keys disabled (all)', fakeAsync(() => {
      configureAndCreate();
      host.featureKeys = ['A', 'C'];
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));
  });

  describe('requirement prop', () => {
    it('should render when any key enabled (requirement: any)', fakeAsync(() => {
      configureAndCreate();
      host.featureKeys = ['A', 'C'];
      host.requirement = 'any';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));

    it('should not render when none enabled (requirement: any)', fakeAsync(() => {
      configureAndCreate();
      host.featureKeys = ['C'];
      host.requirement = 'any';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));
  });

  describe('negate prop', () => {
    it('should hide when enabled and negate true', fakeAsync(() => {
      configureAndCreate();
      host.featureKey = 'Enabled';
      host.negate = true;
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));

    it('should show when disabled and negate true', fakeAsync(() => {
      configureAndCreate();
      host.featureKey = 'Disabled';
      host.negate = true;
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));
  });

  describe('Combined featureKey + featureKeys', () => {
    it('should combine into single gate', fakeAsync(() => {
      configureAndCreate();
      host.featureKey = 'A';
      host.featureKeys = ['B'];
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));

    it('should fail combined gate when one disabled', fakeAsync(() => {
      configureAndCreate();
      host.featureKey = 'A';
      host.featureKeys = ['C'];
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));
  });

  describe('Empty gate', () => {
    it('should render for empty gate (no featureKey/featureKeys)', fakeAsync(() => {
      configureAndCreate();
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
    }));
  });

  describe('showFeatureDuringEvaluation', () => {
    it('should respect shouldShowFeatureDuringEvaluation from service', () => {
      configureAndCreate({
        featureDefaults: { F1: true },
        showFeatureDuringEvaluation: true,
      });
      host.featureKey = 'F1';
      fixture.detectChanges();
      // Before async resolves, shouldShow is set from shouldShowFeatureDuringEvaluation
      const featureComp = fixture.debugElement.children[0].componentInstance as FeatureComponent;
      expect(featureComp.isLoading).toBe(true);
    });
  });

  describe('Input changes', () => {
    it('should re-evaluate when featureKey changes', fakeAsync(() => {
      configureAndCreate();
      host.featureKey = 'Enabled';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();

      host.featureKey = 'Disabled';
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.content')).toBeNull();
    }));
  });
});
