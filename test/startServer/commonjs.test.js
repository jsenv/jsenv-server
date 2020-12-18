import { createRequire } from "module"
import { assert } from "@jsenv/assert"

const require = createRequire(import.meta.url)
const { startServer, fetchUrl } = require("@jsenv/server")

const { origin } = await startServer({
  logLevel: "warn",
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

{
  const response = await fetchUrl(origin)
  const actual = {
    url: response.url,
    status: response.status,
    body: await response.text(),
  }
  const expected = {
    url: `${origin}/`,
    status: 200,
    body: "ok",
  }
  assert({ actual, expected })
}
