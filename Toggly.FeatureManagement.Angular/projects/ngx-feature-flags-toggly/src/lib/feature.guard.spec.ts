import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, UrlTree } from '@angular/router';
import { featureFlagGuard, FeatureFlagGuard } from './feature.guard';
import { TogglyService } from './toggly.service';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';

describe('Feature Guards', () => {
  function makeRoute(data: Record<string, any>): ActivatedRouteSnapshot {
    return { data } as any as ActivatedRouteSnapshot;
  }

  // ─── Functional Guard ──────────────────────────
  describe('featureFlagGuard (functional)', () => {
    let router: Router;

    beforeEach(() => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { Premium: true, Disabled: false, A: true, B: true, C: false },
        })],
      });
      router = TestBed.inject(Router);
    });

    it('should allow activation when feature is enabled', async () => {
      const route = makeRoute({ featureFlag: 'Premium' });
      const result = await TestBed.runInInjectionContext(() => featureFlagGuard(route, {} as any));
      expect(result).toBe(true);
    });

    it('should redirect when feature is disabled', async () => {
      const route = makeRoute({ featureFlag: 'Disabled', featureFlagRedirect: '/upgrade' });
      const result = await TestBed.runInInjectionContext(() => featureFlagGuard(route, {} as any));
      expect(result).toBeInstanceOf(UrlTree);
      expect((result as UrlTree).toString()).toBe('/upgrade');
    });

    it('should default redirect to /', async () => {
      const route = makeRoute({ featureFlag: 'Disabled' });
      const result = await TestBed.runInInjectionContext(() => featureFlagGuard(route, {} as any));
      expect(result).toBeInstanceOf(UrlTree);
      expect((result as UrlTree).toString()).toBe('/');
    });

    it('should handle array of feature flags', async () => {
      const route = makeRoute({ featureFlag: ['A', 'B'] });
      const result = await TestBed.runInInjectionContext(() => featureFlagGuard(route, {} as any));
      expect(result).toBe(true);
    });

    it('should respect requirement: any', async () => {
      const route = makeRoute({ featureFlag: ['A', 'C'], featureFlagRequirement: 'any' });
      const result = await TestBed.runInInjectionContext(() => featureFlagGuard(route, {} as any));
      expect(result).toBe(true);
    });

    it('should respect negate', async () => {
      const route = makeRoute({ featureFlag: 'Premium', featureFlagNegate: true });
      const result = await TestBed.runInInjectionContext(() => featureFlagGuard(route, {} as any));
      expect(result).toBeInstanceOf(UrlTree);
    });

    it('should default requirement to all', async () => {
      const route = makeRoute({ featureFlag: ['A', 'C'] });
      const result = await TestBed.runInInjectionContext(() => featureFlagGuard(route, {} as any));
      expect(result).toBeInstanceOf(UrlTree);
    });
  });

  // ─── Class-based Guard ──────────────────────────
  describe('FeatureFlagGuard (class-based)', () => {
    let guard: FeatureFlagGuard;
    let router: Router;

    beforeEach(() => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { Premium: true, Disabled: false, A: true, B: true, C: false },
        })],
      });
      guard = TestBed.inject(FeatureFlagGuard);
      router = TestBed.inject(Router);
    });

    it('should be created', () => {
      expect(guard).toBeTruthy();
    });

    it('should return true when feature is enabled', async () => {
      const route = makeRoute({ featureFlag: 'Premium' });
      const result = await guard.canActivate(route);
      expect(result).toBe(true);
    });

    it('should return false and navigate when feature is disabled', async () => {
      const navigateSpy = spyOn(router, 'navigate');
      const route = makeRoute({ featureFlag: 'Disabled', featureFlagRedirect: '/upgrade' });
      const result = await guard.canActivate(route);
      expect(result).toBe(false);
      expect(navigateSpy).toHaveBeenCalledWith(['/upgrade']);
    });

    it('should default redirect to /', async () => {
      const navigateSpy = spyOn(router, 'navigate');
      const route = makeRoute({ featureFlag: 'Disabled' });
      await guard.canActivate(route);
      expect(navigateSpy).toHaveBeenCalledWith(['/']);
    });

    it('should handle array of feature flags', async () => {
      const route = makeRoute({ featureFlag: ['A', 'B'] });
      const result = await guard.canActivate(route);
      expect(result).toBe(true);
    });

    it('should respect requirement: any', async () => {
      const route = makeRoute({ featureFlag: ['A', 'C'], featureFlagRequirement: 'any' });
      const result = await guard.canActivate(route);
      expect(result).toBe(true);
    });

    it('should respect negate', async () => {
      const navigateSpy = spyOn(router, 'navigate');
      const route = makeRoute({ featureFlag: 'Premium', featureFlagNegate: true });
      const result = await guard.canActivate(route);
      expect(result).toBe(false);
      expect(navigateSpy).toHaveBeenCalled();
    });
  });
});
