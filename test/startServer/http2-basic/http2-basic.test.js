import { createRequire } from "module"
import { assert } from "@jsenv/assert"
import { resolveUrl } from "@jsenv/util"
import { startServer, serveFile } from "../../../index.js"

const require = createRequire(import.meta.url)
const testDirectoryUrl = resolveUrl("./", import.meta.url)

const puppeteer = require("puppeteer")

let connectionCount = 0
// const http1Server = await startServer({
//   // keepProcessAlive: false,
//   port: 3456,
//   requestToResponse: (request) => {
//     const fileUrl = resolveUrl(request.ressource.slice(1), testDirectoryUrl)
//     return serveFile(fileUrl, request)
//   },
//   connectionCallback: () => {
//     connectionCount++
//   },
// })
// const browser = await puppeteer.launch({
//   headless: false,
// })
// const page = await browser.newPage()
// await page.goto(`${http1Server.origin}/index.html`)
// const actual = connectionCount
// const expected = connectionCount
// assert({ actual, expected })
// await http1Server.stop()

const http2Server = await startServer({
  // keepProcessAlive: false,
  port: 3456,
  http2: true,
  requestToResponse: (request) => {
    const fileUrl = resolveUrl(request.ressource.slice(1), testDirectoryUrl)
    return serveFile(fileUrl, request)
  },
  connectionCallback: () => {
    connectionCount++
  },
})
const browser = await puppeteer.launch({
  headless: false,
})
const page = await browser.newPage()
await page.goto(`${http2Server.origin}/index.html`)
browser.close()
