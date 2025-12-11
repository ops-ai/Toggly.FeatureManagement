<?php

namespace Toggly\Laravel\Middleware;

use Closure;
use Illuminate\Http\Request;
use Toggly\FeatureManagement\Core\FeatureManager;
use Symfony\Component\HttpFoundation\Response;

/**
 * Middleware to gate routes based on feature flags
 */
class FeatureGateMiddleware
{
    private FeatureManager $featureManager;

    public function __construct(FeatureManager $featureManager)
    {
        $this->featureManager = $featureManager;
    }

    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure  $next
     * @param  string  $feature
     * @param  string|null  $redirectTo
     * @return mixed
     */
    public function handle(Request $request, Closure $next, string $feature, ?string $redirectTo = null): Response
    {
        $context = $this->buildContext($request);
        
        if (!$this->featureManager->isEnabled($feature, $context)) {
            if ($redirectTo !== null) {
                return redirect($redirectTo);
            }
            
            abort(404, 'Feature not enabled');
        }

        return $next($request);
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
