import { assert } from "@jsenv/assert"
import { startServer, fetchUrl } from "../../index.js"

const { origin, stop } = await startServer({
  logLevel: "off",
  requestToResponse: () => undefined,
})

{
  const actual = await fetchUrl(origin, { simplified: true })
  const expected = {
    url: `${origin}/`,
    status: 501,
    statusText: "Not Implemented",
    headers: {
      "connection": "close",
      "date": actual.headers.date,
      "transfer-encoding": "chunked",
    },
    body: "",
  }
  assert({ actual, expected })
}

stop()
