import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:120000,
  expect:{timeout:20000},outputDir:'./outputs/browser-tests',reporter:'list',
  // Never reuse the user's configured, billable Qwen server or its data store.
  use:{baseURL:'http://localhost:5194',headless:true,viewport:{width:1440,height:1100},actionTimeout:20000,trace:'retain-on-failure',launchOptions:process.env.MSP_BROWSER_PATH?{executablePath:process.env.MSP_BROWSER_PATH}:{}},
  webServer:{command:'node node_modules/vite/bin/vite.js --port 5194 --strictPort',url:'http://localhost:5194',reuseExistingServer:false,timeout:120000,env:{CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false',MSP_TEST_STATE_PATH:'.wrangler/test-state'}}
})
