import { resolveDirectoryUrl, resolveUrl } from "@jsenv/util"
import { assert } from "@jsenv/assert"
import { startServer, serveFile, fetchUrl, headersToObject } from "@jsenv/server"

const testDirectoryUrl = resolveUrl("./", import.meta.url)

const server = await startServer({
  logLevel: "warn",
  keepProcessAlive: false,
  requestToResponse: (request) => {
    return serveFile(request, { rootDirectoryUrl: testDirectoryUrl, canReadDirectory: true })
  },
})

const directoryUrl = resolveDirectoryUrl("./dir", testDirectoryUrl)
const requestUrl = resolveUrl("/dir/", server.origin)
const response = await fetchUrl(requestUrl, {
  headers: { accept: "text/html" },
})
const actual = {
  url: response.url,
  status: response.status,
  statusText: response.statusText,
  headers: headersToObject(response.headers),
  body: await response.text(),
}
const expectedBody = `<!DOCTYPE html>
<html>
  <head>
    <title>Directory explorer</title>
    <meta charset="utf-8" />
    <link rel="icon" href="data:," />
  </head>

  <body>
    <h1>Content of directory ${directoryUrl}</h1>
    <ul>
      <li>
        <a href="/dir/file.js">dir/file.js</a>
      </li>
    </ul>
  </body>
</html>`
const expected = {
  url: requestUrl,
  status: 200,
  statusText: "OK",
  headers: {
    "connection": "close",
    "content-length": `${expectedBody.length}`,
    "content-type": "text/html",
    "date": actual.headers.date,
  },
  body: expectedBody,
}
assert({ actual, expected })
