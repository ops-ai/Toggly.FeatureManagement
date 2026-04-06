import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FeatureVariantDirective } from './feature-variant.directive';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';

@Component({
  standalone: true,
  imports: [FeatureVariantDirective],
  template: `
    <div *featureVariant="featureKey; variant: variantName">
      <span class="content">Variant Content</span>
    </div>
  `,
})
class VariantHostComponent {
  featureKey = 'Exp1';
  variantName = 'control';
}

describe('FeatureVariantDirective', () => {
  let fixture: ComponentFixture<VariantHostComponent>;
  let host: VariantHostComponent;

  beforeEach(() => {
    localStorage.clear()
    spyOn(console, 'warn');
    spyOn(globalThis, 'fetch').and.resolveTo({
      json: () => Promise.resolve({
        Exp1: { enabled: true, variant: 'control', configurationValue: null },
        Exp2: { enabled: true, variant: 'treatment', configurationValue: null },
      }),
    } as any);
  });

  function createFixture() {
    TestBed.configureTestingModule({
      imports: [
        VariantHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'k',
          environment: 'Production',
          enableVariants: true,
        }),
      ],
    });
    fixture = TestBed.createComponent(VariantHostComponent);
    host = fixture.componentInstance;
  }

  it('should show content when variant matches', fakeAsync(() => {
    createFixture();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.content')).toBeTruthy();
  }));

  it('should hide content when variant does not match', fakeAsync(() => {
    createFixture();
    host.variantName = 'treatment';
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.content')).toBeNull();
  }));

  it('should hide when featureVariant input is empty', fakeAsync(() => {
    createFixture();
    host.featureKey = '';
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.content')).toBeNull();
  }));
});
