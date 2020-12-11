import { assert } from "@jsenv/assert"
import { startServer, firstServiceWithTiming, fetchUrl } from "@jsenv/server"
import { parseServerTimingHeader } from "@jsenv/server/src/serverTiming.js"

const noContentService = (request) => {
  if (request.ressource !== "/") return null
  return { status: 204 }
}

const okService = (request) => {
  if (request.ressource !== "/whatever") return null
  return { status: 200 }
}

const { origin } = await startServer({
  keepProcessAlive: false,
  logLevel: "warn",
  sendServerTiming: true,
  requestToResponse: firstServiceWithTiming({
    "service:no content": noContentService,
    "service:ok": okService,
  }),
})

{
  const response = await fetchUrl(origin, { simplified: true })
  const actual = {
    status: response.status,
    timing: parseServerTimingHeader(response.headers["server-timing"]),
  }
  const expected = {
    status: 204,
    timing: {
      a: {
        description: "service:no content",
        duration: actual.timing.a.duration,
      },
      b: {
        description: "time to start responding",
        duration: actual.timing.b.duration,
      },
    },
  }
  assert({ actual, expected })
}

{
  const response = await fetchUrl(`${origin}/whatever`, { simplified: true })
  const actual = {
    status: response.status,
    timing: parseServerTimingHeader(response.headers["server-timing"]),
  }
  const expected = {
    status: 200,
    timing: {
      a: {
        description: "service:no content",
        duration: actual.timing.a.duration,
      },
      b: {
        description: "service:ok",
        duration: actual.timing.b.duration,
      },
      c: {
        description: "time to start responding",
        duration: actual.timing.c.duration,
      },
    },
  }
  assert({ actual, expected })
}
