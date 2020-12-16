import { assert } from "@jsenv/assert"
import { startServer, fetchUrl } from "@jsenv/server"
import { headersToObject } from "@jsenv/server/src/headersToObject.js"

const server = await startServer({
  keepProcessAlive: false,
  protocol: "https",
  // TODO: retest with http2 because it behaves strangely
  // http2: true,
  requestToResponse: () => {
    return {
      status: 200,
      body: "Welcome, HTTPS user!",
    }
  },
})

// 301 on http request
{
  const serverHttpOriginUrl = new URL(server.origin)
  serverHttpOriginUrl.protocol = "http"
  const serverHttpOrigin = serverHttpOriginUrl.href
  const response = await fetchUrl(`${serverHttpOrigin}/file.js?page=2`, { redirect: "manual" })
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
      "location": `${server.origin}/file.js?page=2`,
      "transfer-encoding": "chunked",
    },
    body: "",
  }
  assert({ actual, expected })
}

// 200 on https request
{
  const response = await fetchUrl(`${server.origin}`, { ignoreHttpsError: true })
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
