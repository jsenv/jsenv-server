import { assert } from "@jsenv/assert"
import { startServer, firstService, fetchUrl } from "@jsenv/server"

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
  requestToResponse: firstService(noContentService, okService),
})

{
  const actual = await fetchUrl(origin, { simplified: true })
  const expected = {
    url: `${origin}/`,
    status: 204,
    statusText: "No Content",
    headers: {
      connection: "close",
      date: actual.headers.date,
    },
    body: "",
  }
  assert({ actual, expected })
}

{
  const actual = await fetchUrl(`${origin}/whatever`, { simplified: true })
  const expected = {
    url: `${origin}/whatever`,
    status: 200,
    statusText: "OK",
    headers: {
      "connection": "close",
      "date": actual.headers.date,
      "transfer-encoding": "chunked",
    },
    body: "",
  }
  assert({ actual, expected })
}
