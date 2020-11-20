import { assert } from "@jsenv/assert"
import { startServer, fetchUrl } from "@jsenv/server"

const { origin } = await startServer({
  logLevel: "warn",
  protocol: "http",
  keepProcessAlive: false,
  ip: "",
  port: 8998,
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
{
  const actual = origin
  const expected = "http://localhost:8998"
  assert({ actual, expected })
}
{
  const actual = await fetchUrl(origin, { simplified: true })
  const expected = {
    url: `http://localhost:8998/`,
    status: 200,
    statusText: "OK",
    headers: {
      "connection": "close",
      "content-type": "text/plain",
      "date": actual.headers.date,
      "transfer-encoding": "chunked",
    },
    body: "ok",
  }
  assert({ actual, expected })
}
