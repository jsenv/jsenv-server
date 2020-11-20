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
  accessControlAllowCredentials: true,
  accessControlMaxAge: 400,
  keepProcessAlive: false,
  requestToResponse: () => {
    throw new Error("here")
  },
})

const actual = await fetchUrl(server.origin, {
  simplified: true,
  method: "GET",
  headers: {
    "accept": "",
    "origin": "http://example.com:80",
    "access-control-request-method": "GET",
    "access-control-request-headers": "x-whatever",
  },
})
const body = JSON.stringify({ code: "UNKNOWN_ERROR" })
const expected = {
  url: `${server.origin}/`,
  status: 500,
  statusText: "Internal Server Error",
  headers: {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "x-requested-with, x-whatever",
    "access-control-allow-methods": "GET",
    "access-control-allow-origin": "http://example.com:80",
    "access-control-max-age": "400",
    "cache-control": "no-store",
    "connection": "close",
    "content-length": String(Buffer.byteLength(body)),
    "content-type": "application/json",
    "date": actual.headers.date,
    "vary": "origin, access-control-request-method, access-control-request-headers",
  },
  body,
}
assert({ actual, expected })
