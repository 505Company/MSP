import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.', testMatch: 'lab.browser.ts', fullyParallel: false, workers: 1, timeout: 120000,
  outputDir: '../outputs/component-lab-tests', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5197', headless: true, viewport: { width: 1440, height: 1100 }, launchOptions: { executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --config component-lab/vite.config.ts', cwd: '..', url: 'http://127.0.0.1:5197', reuseExistingServer: true, timeout: 60000 },
})
