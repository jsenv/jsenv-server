import { assert } from "@jsenv/assert"
import { jsenvPrivateKey, jsenvCertificate, fetchUrl } from "@jsenv/server"
import { headersToObject } from "@jsenv/server/src/headersToObject.js"
import { listen } from "@jsenv/server/src/internal/listen.js"
import { createPolyglotServer } from "@jsenv/server/src/internal/server-polyglot.js"
import { listenRequest } from "@jsenv/server/src/internal/listenRequest.js"

const server = await createPolyglotServer({
  privateKey: jsenvPrivateKey,
  certificate: jsenvCertificate,
})
listenRequest(server, (nodeRequest, nodeResponse) => {
  if (!nodeRequest.socket.encrypted) {
    const host = nodeRequest.headers.host || nodeRequest.authority
    nodeResponse.writeHead(301, { location: `https://${host}${nodeRequest.url}` })
    nodeResponse.end()
    return
  }

  nodeResponse.writeHead(200, { "content-Type": "text/plain" })
  nodeResponse.end("Welcome, HTTPS user!")
})
server.unref()
const port = await listen({
  server,
  port: 0,
  ip: "127.0.0.1",
})

// 301 on http request
{
  const response = await fetchUrl(`http://127.0.0.1:${port}/file.js?page=2`, { redirect: "manual" })
  const actual = {
    status: response.status,
    headers: headersToObject(response.headers),
    body: await response.text(),
  }
  const expected = {
    status: 301,
    headers: {
      "connection": "close",
      "date": actual.headers.date,
      "location": `https://127.0.0.1:${port}/file.js?page=2`,
      "transfer-encoding": "chunked",
    },
    body: "",
  }
  assert({ actual, expected })
}

// 200 on https request
{
  const response = await fetchUrl(`https://127.0.0.1:${port}`, { ignoreHttpsError: true })
  const actual = {
    status: response.status,
    body: await response.text(),
  }
  const expected = {
    status: 200,
    body: "Welcome, HTTPS user!",
  }
  assert({ actual, expected })
}
