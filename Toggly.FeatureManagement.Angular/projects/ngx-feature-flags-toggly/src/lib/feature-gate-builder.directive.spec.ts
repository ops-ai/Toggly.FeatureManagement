import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FeatureGateBuilderDirective } from './feature-gate-builder.directive';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';

@Component({
  standalone: true,
  imports: [FeatureGateBuilderDirective],
  template: `
    <button
      *featureGateBuilder="flag; requirement: requirement; let enabled"
      [class.active]="enabled"
    >
      Sales
    </button>
  `,
})
class BuilderHostComponent {
  flag: string | string[] = ['Enabled', 'Disabled'];
  requirement: 'all' | 'any' = 'all';
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
});
