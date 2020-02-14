import { createRequire } from "module"
import { assert } from "@jsenv/assert"
import { resolveUrl } from "@jsenv/util"
import { startServer, serveFile } from "../../../index.js"

const require = createRequire(import.meta.url)
const testDirectoryUrl = resolveUrl("./", import.meta.url)

const puppeteer = require("puppeteer")

const http2Server = await startServer({
  keepProcessAlive: false,
  protocol: "https",
  port: 3456,
  http2: true,
  requestToResponse: (request) => {
    const fileUrl = resolveUrl(request.ressource.slice(1), testDirectoryUrl)
    return serveFile(fileUrl, request)
  },
})
const browser = await puppeteer.launch({
  headless: false,
})
const page = await browser.newPage()
await page.goto(`${http2Server.origin}/index.html`)
const actual = await page.evaluate(`window.ask()`)
const expected = 42
assert({ actual, expected })
browser.close()
