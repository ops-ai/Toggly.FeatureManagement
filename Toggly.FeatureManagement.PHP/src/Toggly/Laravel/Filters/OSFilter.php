<?php

namespace Toggly\Laravel\Filters;

use Illuminate\Http\Request;
use Toggly\FeatureManagement\Models\FeatureFilter;

/**
 * Operating system filter for Laravel
 */
class OSFilter
{
    /**
     * Evaluate OS filter
     */
    public function evaluate(FeatureFilter $filter, ?Request $request = null): bool
    {
        if ($request === null) {
            return false;
        }

        $userAgent = $request->userAgent() ?? '';
        $allowedOS = explode(',', $filter->parameters['operatingSystems'] ?? '');

        $os = $this->detectOS($userAgent);

        return in_array($os, $allowedOS, true);
    }

    /**
     * Detect OS from user agent
     */
    private function detectOS(string $userAgent): string
    {
        $userAgent = strtolower($userAgent);

        if (preg_match('/windows/i', $userAgent)) {
            return 'Windows';
        }
        if (preg_match('/macintosh|mac os x/i', $userAgent)) {
            return 'macOS';
        }
        if (preg_match('/linux/i', $userAgent)) {
            return 'Linux';
        }
        if (preg_match('/android/i', $userAgent)) {
            return 'Android';
        }
        if (preg_match('/iphone|ipad|ipod/i', $userAgent)) {
            return 'iOS';
        }

        return 'Unknown';
    }
}
