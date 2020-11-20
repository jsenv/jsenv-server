import { resolveUrl, writeFile, ensureEmptyDirectory } from "@jsenv/util"
import { startServer, fetchUrl } from "@jsenv/server"

const htmlFilesDirectoryUrl = resolveUrl("./html-files/", import.meta.url)

// we need a deterministic stack trace, otherwise
// test would fail in CI
const deterministicStackTrace = `Error: test
    at requestToResponse (file:///Users/d.maillard/Dev/Github/jsenv-server/test/startServer/internal-error/generate-internal-error-html-files.js:45:19)
    at generateResponseDescription (file:///Users/d.maillard/Dev/Github/jsenv-server/src/startServer.js:456:42)
    at file:///Users/d.maillard/Dev/Github/jsenv-server/src/startServer.js:302:64
    at timeFunction (file:///Users/d.maillard/Dev/Github/jsenv-server/src/serverTiming.js:19:23)
    at Server.requestCallback (file:///Users/d.maillard/Dev/Github/jsenv-server/src/startServer.js:302:17)
    at Server.emit (events.js:326:22)
    at parserOnIncoming (_http_server.js:777:12)
    at HTTPParser.parserOnHeadersComplete (_http_common.js:119:17)`

const generateInternalErrorHtmlFile = async (htmlFilename, serverParams) => {
  const { origin, stop } = await startServer({
    logLevel: "off",
    protocol: "http",
    keepProcessAlive: false,
    ...serverParams,
  })
  {
    const response = await fetchUrl(origin, {
      simplified: true,
      headers: {
        accept: "text/html",
      },
    })
    stop()
    const htmlFileUrl = resolveUrl(htmlFilename, htmlFilesDirectoryUrl)
    await writeFile(htmlFileUrl, response.body)
  }
}

await ensureEmptyDirectory(htmlFilesDirectoryUrl)

await generateInternalErrorHtmlFile("basic.html", {
  requestToResponse: () => {
    const error = new Error("test")
    throw error
  },
})

await generateInternalErrorHtmlFile("basic-with-details.html", {
  requestToResponse: () => {
    const error = new Error("test")
    error.stack = deterministicStackTrace
    throw error
  },
  sendServerInternalErrorDetails: true,
})

// only error.stack is shown in the html page.
// any extra property (like error.code) are not available.
// maybe we want to have extra properties as well ?
// I let the test below to keep this in mind
await generateInternalErrorHtmlFile("basic-with-code-and-details.html", {
  requestToResponse: () => {
    const error = new Error("test")
    error.code = "TEST_CODE"
    error.stack = deterministicStackTrace
    throw error
  },
  sendServerInternalErrorDetails: true,
})

await generateInternalErrorHtmlFile("literal.html", {
  requestToResponse: () => {
    const error = "a string"
    throw error
  },
})

await generateInternalErrorHtmlFile("literal-with-details.html", {
  requestToResponse: () => {
    const error = "a string"
    throw error
  },
  sendServerInternalErrorDetails: true,
})
