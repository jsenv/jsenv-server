import { assert } from "@jsenv/assert"
import { startServer } from "../../index.js"
import { fetch } from "../testHelpers.js"

const { origin, stop } = await startServer({
  logLevel: "off",
  requestToResponse: () => undefined,
})

{
  const actual = await fetch(origin)
  const expected = {
    url: `${origin}/`,
    status: 501,
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
