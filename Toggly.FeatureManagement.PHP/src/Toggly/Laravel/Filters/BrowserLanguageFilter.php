<?php

namespace Toggly\Laravel\Filters;

use Illuminate\Http\Request;
use Toggly\FeatureManagement\Models\FeatureFilter;

/**
 * Browser language filter for Laravel
 */
class BrowserLanguageFilter
{
    /**
     * Evaluate browser language filter
     */
    public function evaluate(FeatureFilter $filter, ?Request $request = null): bool
    {
        if ($request === null) {
            return false;
        }

        $acceptLanguage = $request->header('Accept-Language', '');
        $allowedLanguages = explode(',', $filter->parameters['languages'] ?? '');

        foreach ($allowedLanguages as $language) {
            $language = trim($language);
            if (stripos($acceptLanguage, $language) !== false) {
                return true;
            }
        }

        return false;
    }
}
