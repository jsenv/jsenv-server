import { assert } from "@jsenv/assert"
import { startServer, timeFunction, fetchUrl } from "@jsenv/server"
import { parseServerTimingHeader } from "@jsenv/server/src/serverTiming.js"

const { origin } = await startServer({
  keepProcessAlive: false,
  sendServerTiming: true,
  logLevel: "warn",
  requestToResponse: async () => {
    const [waitTiming] = await timeFunction("waiting 50ms", async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
    })

    return {
      status: 200,
      timing: waitTiming,
    }
  },
})

{
  const response = await fetchUrl(origin)
  const actual = parseServerTimingHeader(response.headers.get("server-timing"))
  const expected = {
    a: {
      description: "waiting 50ms",
      duration: actual.a.duration,
    },
    b: {
      description: "time to start responding",
      duration: actual.b.duration,
    },
  }
  assert({ actual, expected })
}
