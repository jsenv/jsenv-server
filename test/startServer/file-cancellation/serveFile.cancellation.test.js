import { resolveUrl, writeFile } from "@jsenv/util"
import { createCancellationSource, createCancelError } from "@jsenv/cancellation"
import { assert } from "@jsenv/assert"
import { startServer, serveFile, fetchUrl } from "../../../index.js"

const tempDirectoryUrl = resolveUrl("./temp/", import.meta.url)
const fileUrl = resolveUrl("./file.js", tempDirectoryUrl)
const cancellationSource = createCancellationSource()
await writeFile(fileUrl)

const server = await startServer({
  logLevel: "warn",
  protocol: "https",
  keepProcessAlive: false,
  ip: "",
  port: 8998,
  requestToResponse: (request) => {
    return serveFile(resolveUrl(request.ressource.slice(1), tempDirectoryUrl), request)
  },
})
const fileServerUrl = resolveUrl("./file.js", server.origin)
// we can abort a request to the server
{
  const reason = "whatever"
  setTimeout(() => {
    cancellationSource.cancel(reason)
  }, 5)
  try {
    await fetchUrl(fileServerUrl, { cancellationToken: cancellationSource.token })
    throw new Error("should throw")
  } catch (actual) {
    const expected = createCancelError(reason)
    assert({ actual, expected })
  }
}
// it still works and can respond to an other request
{
  const { status } = await fetchUrl(fileServerUrl)
  const actual = { status }
  const expected = { status: 200 }
  assert({ actual, expected })
}
