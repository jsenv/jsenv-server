import { assert } from "@dmail/assert"
import { startServer } from "../../index.js"

const fetch = import.meta.require("node-fetch")

const server = await startServer({
  protocol: "http",
  port: 8998,
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

const response = await fetch(server.origin, {
  method: "GET",
  headers: {
    origin: "http://example.com:80",
    "access-control-request-method": "GET",
    "access-control-request-headers": "x-whatever",
  },
})
const headers = {}
response.headers.forEach((value, key) => {
  headers[key] = value
})
const body = await response.json()
const actual = { headers, body }
const expected = {
  headers: {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "x-requested-with, x-whatever",
    "access-control-allow-methods": "GET",
    "access-control-allow-origin": "http://example.com:80",
    "access-control-max-age": "400",
    "cache-control": "no-store",
    connection: "close",
    "content-length": "24",
    "content-type": "application/json",
    date: response.headers.get("date"),
    vary: "origin, access-control-request-method, access-control-request-headers",
  },
  body: {
    code: "UNKNOWN_ERROR",
  },
}
assert({ actual, expected })
