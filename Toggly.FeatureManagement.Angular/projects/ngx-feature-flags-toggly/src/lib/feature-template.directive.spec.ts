import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, ViewChild, TemplateRef } from '@angular/core';
import { FeatureTemplateDirective } from './feature-template.directive';

@Component({
  standalone: true,
  imports: [FeatureTemplateDirective],
  template: `
    <ng-template featureTemplate>
      <span class="template-content">Template Content</span>
    </ng-template>
  `,
})
class TemplateHostComponent {
  @ViewChild(FeatureTemplateDirective) directive!: FeatureTemplateDirective;
}

describe('FeatureTemplateDirective', () => {
  let fixture: ComponentFixture<TemplateHostComponent>;
  let host: TemplateHostComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TemplateHostComponent],
    });
    fixture = TestBed.createComponent(TemplateHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(host.directive).toBeTruthy();
  });

  it('should have templateRef', () => {
    expect(host.directive.templateRef).toBeTruthy();
    expect(host.directive.templateRef).toBeInstanceOf(TemplateRef);
  });
});
