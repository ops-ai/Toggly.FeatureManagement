<?php

namespace Toggly\Laravel\Filters;

use Illuminate\Http\Request;
use Toggly\FeatureManagement\Models\FeatureFilter;

/**
 * Device type filter for Laravel
 */
class DeviceTypeFilter
{
    /**
     * Evaluate device type filter
     */
    public function evaluate(FeatureFilter $filter, ?Request $request = null): bool
    {
        if ($request === null) {
            return false;
        }

        $userAgent = $request->userAgent() ?? '';
        $allowedTypes = explode(',', $filter->parameters['deviceTypes'] ?? '');

        $deviceType = $this->detectDeviceType($userAgent);

        return in_array($deviceType, $allowedTypes, true);
    }

    /**
     * Detect device type from user agent
     */
    private function detectDeviceType(string $userAgent): string
    {
        $userAgent = strtolower($userAgent);

        if (preg_match('/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i', $userAgent)) {
            return 'Mobile';
        }

        if (preg_match('/tablet|ipad|playbook|silk/i', $userAgent)) {
            return 'Tablet';
        }

        return 'Desktop';
    }
}
