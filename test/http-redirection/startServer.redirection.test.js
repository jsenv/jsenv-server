import { assert } from "@jsenv/assert"
import { startServer, fetchUrl } from "@jsenv/server"
import { headersToObject } from "@jsenv/server/src/headersToObject.js"

// http1 server
{
  const server = await startServer({
    logLevel: "warn",
    keepProcessAlive: false,
    protocol: "https",
    requestToResponse: () => {
      return {
        status: 200,
        body: "Welcome, HTTPS user!",
      }
    },
  })

  // 301 on http
  {
    const serverHttpOriginUrl = new URL(server.origin)
    serverHttpOriginUrl.protocol = "http"
    const serverHttpOrigin = serverHttpOriginUrl.href.slice(0, -1)
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

  // 200 in https
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
}

// http2 server
{
  const server = await startServer({
    logLevel: "warn",
    keepProcessAlive: false,
    protocol: "https",
    http2: true,
    requestToResponse: () => {
      return {
        status: 200,
        body: "Welcome, HTTPS user!",
      }
    },
  })

  // 301 on http
  {
    const serverHttpOriginUrl = new URL(server.origin)
    serverHttpOriginUrl.protocol = "http"
    const serverHttpOrigin = serverHttpOriginUrl.href.slice(0, -1)
    const response = await fetchUrl(`${serverHttpOrigin}`, { redirect: "manual" })
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
        "location": `${server.origin}/`,
        "transfer-encoding": "chunked",
      },
      body: "",
    }
    assert({ actual, expected })
  }

  // 200 in https
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
}
