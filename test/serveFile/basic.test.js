import { resolveUrl, readFile, bufferToEtag } from "@jsenv/util"
import { assert } from "@jsenv/assert"
import { serveFile } from "../../index.js"

const testDirectoryUrl = resolveUrl("./", import.meta.url)

{
  const sourceUrl = resolveUrl("./file.js?ok=true", testDirectoryUrl)
  const actual = await serveFile(sourceUrl, {
    etagEnabled: true,
  })
  const sourceBuffer = await readFile(sourceUrl, { as: "buffer" })
  const expected = {
    status: 200,
    statusText: undefined,
    headers: {
      "cache-control": "private,max-age=0,must-revalidate",
      "content-type": "application/javascript",
      "content-length": sourceBuffer.length,
      "etag": bufferToEtag(sourceBuffer),
    },
    body: actual.body,
    bodyEncoding: undefined,
    timing: {
      "file service>read file stat": actual.timing["file service>read file stat"],
      "file service>generate file etag": actual.timing["file service>generate file etag"],
    },
  }
  assert({ actual, expected })
}

{
  const directoryUrl = testDirectoryUrl
  const actual = await serveFile(directoryUrl)
  const expected = {
    status: 403,
    statusText: "not allowed to read directory",
    timing: {
      ["file service>read file stat"]: actual.timing["file service>read file stat"],
    },
  }
  assert({ actual, expected })
}

{
  const directoryUrl = testDirectoryUrl
  const actual = await serveFile(directoryUrl, {
    canReadDirectory: true,
  })
  const expected = {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-length": actual.headers["content-length"],
    },
    body: actual.body,
    timing: {
      ["file service>read file stat"]: actual.timing["file service>read file stat"],
      ["file service>read directory"]: actual.timing["file service>read directory"],
    },
  }
  assert({ actual, expected })
}
