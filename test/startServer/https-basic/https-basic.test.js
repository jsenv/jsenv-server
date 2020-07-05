import { createRequire } from "module"
import { assert } from "@jsenv/assert"
import { resolveUrl } from "@jsenv/util"
import { startServer, serveFile } from "../../../index.js"

const require = createRequire(import.meta.url)
const testDirectoryUrl = resolveUrl("./", import.meta.url)

const { chromium } = require("playwright-chromium")

const server = await startServer({
  logLevel: "warn",
  keepProcessAlive: false,
  protocol: "https",
  http2: true,
  port: 3456,
  requestToResponse: (request) => {
    const fileUrl = resolveUrl(request.ressource.slice(1), testDirectoryUrl)
    return serveFile(fileUrl, request)
  },
})
const browser = await chromium.launch({
  // headless: false,
})
const page = await browser.newPage({
  ignoreHTTPSErrors: true,
})
await page.goto(`${server.origin}/index.html`)
const actual = await page.evaluate(`window.ask()`)
const expected = 42
assert({ actual, expected })
browser.close()
