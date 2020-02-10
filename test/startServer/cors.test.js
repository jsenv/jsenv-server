import { assert } from "@jsenv/assert"
import { startServer, fetchUrl } from "../../index.js"

const server = await startServer({
  protocol: "http",
  logLevel: "off",
  cors: true,
  accessControlAllowRequestOrigin: true,
  accessControlAllowRequestMethod: true,
  accessControlAllowRequestHeaders: true,
  accessControlAllowedMethods: [],
  accessControlMaxAge: 400,
  keepProcessAlive: false,
  requestToResponse: () => {
    return {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
      body: "ok",
    }
  },
})

const actual = await fetchUrl(server.origin, {
  simplified: true,
  method: "OPTIONS",
  headers: {
    "origin": "http://example.com:80",
    "access-control-request-method": "GET",
    "access-control-request-headers": "x-whatever",
  },
})
const expected = {
  url: `${server.origin}/`,
  status: 200,
  statusText: "OK",
  headers: {
    "access-control-allow-headers": "x-requested-with, x-whatever",
    "access-control-allow-methods": "GET",
    "access-control-allow-origin": "http://example.com:80",
    "access-control-max-age": "400",
    "connection": "close",
    "content-length": "0",
    "date": actual.headers.date,
    "vary": "origin, access-control-request-method, access-control-request-headers",
  },
  body: "",
}
assert({ actual, expected })
