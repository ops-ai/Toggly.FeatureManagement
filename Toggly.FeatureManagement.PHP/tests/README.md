# Toggly PHP SDK Tests

This directory contains the test suite for the Toggly Feature Management PHP SDK.

## Running Tests

### Run All Tests
```bash
vendor/bin/phpunit
```

### Run Specific Test Suite
```bash
vendor/bin/phpunit tests/Unit
```

### Run with Coverage
```bash
vendor/bin/phpunit --coverage-html coverage-html
```

### Run with Coverage Report
```bash
vendor/bin/phpunit --coverage-text
```

## Test Structure

```
tests/
├── Unit/               # Unit tests for core functionality
│   ├── Models/        # Model tests
│   └── Core/          # Core service tests
├── Integration/       # Integration tests (future)
└── Fixtures/          # Test fixtures and data (future)
```

## Writing Tests

Tests should follow PSR-4 autoloading standards and be placed in the appropriate directory:

- **Unit tests**: Tests for individual classes and methods
- **Integration tests**: Tests for interaction between components
- **Feature tests**: End-to-end tests for complete features

### Example Test

```php
<?php

namespace Toggly\FeatureManagement\Tests\Unit;

use PHPUnit\Framework\TestCase;

class ExampleTest extends TestCase
{
    public function testExample(): void
    {
        $this->assertTrue(true);
    }
}
```

## Requirements

- PHP 7.4+ or 8.0+
- PHPUnit 9.0+ or 10.0+
- Composer dependencies installed

## CI/CD Integration

Tests are automatically run in GitHub Actions across multiple PHP versions (7.4, 8.0, 8.1, 8.2, 8.3) to ensure compatibility.
