<?php

namespace Toggly\Laravel\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use ReflectionClass;
use ReflectionMethod;
use Symfony\Component\HttpFoundation\Response;
use Toggly\FeatureManagement\Core\FeatureManager;
use Toggly\Laravel\Attributes\FeatureGate as FeatureGateAttribute;
use Toggly\Laravel\Attributes\FeatureUsage as FeatureUsageAttribute;

/**
 * Middleware that automatically reads FeatureGate attributes from controllers and methods.
 * 
 * This provides the same functionality as C#'s FeatureGate attribute system,
 * automatically gating routes based on attributes without needing to manually
 * add middleware to routes.
 */
class FeatureGateAttributeMiddleware
{
    private FeatureManager $featureManager;

    public function __construct(FeatureManager $featureManager)
    {
        $this->featureManager = $featureManager;
    }

    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $route = $request->route();
        
        if (!$route) {
            return $next($request);
        }

        $action = $route->getAction();
        $controller = $action['controller'] ?? null;

        if (!$controller || !is_string($controller)) {
            return $next($request);
        }

        [$controllerClass, $methodName] = explode('@', $controller, 2);

        if (!class_exists($controllerClass)) {
            return $next($request);
        }

        $reflection = new ReflectionClass($controllerClass);
        
        // Check controller-level attributes
        $controllerAttributes = $reflection->getAttributes(FeatureGateAttribute::class);
        foreach ($controllerAttributes as $attribute) {
            $featureGate = $attribute->newInstance();
            if (!$this->checkFeatureGate($featureGate, $request)) {
                return $this->handleDisabledFeature($featureGate, $request);
            }
        }

        // Check method-level attributes
        if ($reflection->hasMethod($methodName)) {
            $method = $reflection->getMethod($methodName);
            $methodAttributes = $method->getAttributes(FeatureGateAttribute::class);
            
            foreach ($methodAttributes as $attribute) {
                $featureGate = $attribute->newInstance();
                if (!$this->checkFeatureGate($featureGate, $request)) {
                    return $this->handleDisabledFeature($featureGate, $request);
                }
            }

            // Track feature usage for method-level FeatureUsage attributes
            $usageAttributes = $method->getAttributes(FeatureUsageAttribute::class);
            foreach ($usageAttributes as $attribute) {
                $featureUsage = $attribute->newInstance();
                $this->trackFeatureUsage($featureUsage, $request);
            }
        }

        // Track feature usage for controller-level FeatureUsage attributes
        $controllerUsageAttributes = $reflection->getAttributes(FeatureUsageAttribute::class);
        foreach ($controllerUsageAttributes as $attribute) {
            $featureUsage = $attribute->newInstance();
            $this->trackFeatureUsage($featureUsage, $request);
        }

        return $next($request);
    }

    /**
     * Check if feature gate requirements are met
     */
    private function checkFeatureGate(FeatureGateAttribute $featureGate, Request $request): bool
    {
        $context = $this->buildContext($request);
        $features = $featureGate->getFeatures();
        $requirement = $featureGate->requirement;

        if ($requirement === 'All') {
            // All features must be enabled
            foreach ($features as $feature) {
                if (!$this->featureManager->isEnabled($feature, $context)) {
                    return false;
                }
            }
            return true;
        } else {
            // Any feature must be enabled
            foreach ($features as $feature) {
                if ($this->featureManager->isEnabled($feature, $context)) {
                    return true;
                }
            }
            return false;
        }
    }

    /**
     * Handle disabled feature
     */
    private function handleDisabledFeature(FeatureGateAttribute $featureGate, Request $request): Response
    {
        if ($featureGate->redirectTo !== null) {
            return redirect($featureGate->redirectTo);
        }

        $statusCode = $featureGate->statusCode ?? 404;
        abort($statusCode, 'Feature not enabled');
    }

    /**
     * Track feature usage for statistics
     */
    private function trackFeatureUsage(FeatureUsageAttribute $featureUsage, Request $request): void
    {
        $context = $this->buildContext($request);
        $features = $featureUsage->getFeatures();

        foreach ($features as $feature) {
            // Check if enabled (usage is only tracked if feature is actually enabled)
            if ($this->featureManager->isEnabled($feature, $context)) {
                // Usage tracking happens automatically via FeatureManager's evaluation
                // This attribute just marks the intent for documentation/clarity
            }
        }
    }

    /**
     * Build context from request
     */
    private function buildContext(Request $request): array
    {
        $context = [];

        if ($request->user()) {
            $context['userId'] = $request->user()->id;
            $context['user_id'] = $request->user()->id;
            
            // Add groups if available
            if (method_exists($request->user(), 'groups')) {
                $context['groups'] = $request->user()->groups();
            }
        }

        $context['ip'] = $request->ip();

        return $context;
    }
}
