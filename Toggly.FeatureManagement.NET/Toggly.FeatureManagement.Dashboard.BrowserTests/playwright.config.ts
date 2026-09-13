import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseDirectory = mkdtempSync(join(tmpdir(), 'toggly-dashboard-browser-'));
const dotnet = process.env.TOGGLY_TEST_DOTNET || 'dotnet';
const project = process.env.TOGGLY_TEST_HOST_PROJECT || '../examples/Toggly.Examples.EmbeddedSqlite/Toggly.Examples.EmbeddedSqlite.csproj';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5187', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-no-javascript', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, javaScriptEnabled: false } }
  ],
  webServer: {
    command: `"${dotnet}" run --project "${project}" -c Release --no-launch-profile --urls http://127.0.0.1:5187`,
    url: 'http://127.0.0.1:5187/',
    timeout: 120000,
    reuseExistingServer: false,
    env: { ConnectionStrings__TogglyCatalog: `Data Source=${join(databaseDirectory, 'catalog.db')}`, DOTNET_CLI_TELEMETRY_OPTOUT: '1' }
  }
});
