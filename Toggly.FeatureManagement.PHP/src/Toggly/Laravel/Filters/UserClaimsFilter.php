<?php

namespace Toggly\Laravel\Filters;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Toggly\FeatureManagement\Models\FeatureFilter;

/**
 * User claims filter for Laravel
 */
class UserClaimsFilter
{
    /**
     * Evaluate user claims filter
     */
    public function evaluate(FeatureFilter $filter, ?Request $request = null): bool
    {
        if ($request === null) {
            return false;
        }

        $user = Auth::user();
        if ($user === null) {
            return false;
        }

        // Check for required claims
        $requiredClaims = explode(',', $filter->parameters['claims'] ?? '');
        foreach ($requiredClaims as $claim) {
            $claim = trim($claim);
            
            // Check if user has the claim/attribute
            if (isset($user->$claim) && $user->$claim) {
                return true;
            }
            
            // Check if it's a method
            if (method_exists($user, $claim) && $user->$claim()) {
                return true;
            }
        }

        return false;
    }
}
