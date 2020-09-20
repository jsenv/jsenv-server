import { resolveUrl, readFile, bufferToEtag } from "@jsenv/util"
import { assert } from "@jsenv/assert"
import { serveFile } from "../../index.js"

const testDirectoryUrl = resolveUrl("./", import.meta.url)
const sourceUrl = resolveUrl("./file.js?ok=true", testDirectoryUrl)

const actual = await serveFile(sourceUrl, {
  etagEnabled: true,
})
const sourceBuffer = Buffer.from(await readFile(sourceUrl))
const expected = {
  status: 200,
  statusText: undefined,
  headers: {
    "cache-control": "private",
    "content-type": "application/javascript",
    "content-length": sourceBuffer.length,
    "etag": bufferToEtag(sourceBuffer),
  },
  body: sourceBuffer,
  bodyEncoding: undefined,
  timing: {
    "file service>read file stat": actual.timing["file service>read file stat"],
    "file service>read file": actual.timing["file service>read file"],
    "file service>generate file etag": actual.timing["file service>generate file etag"],
  },
}
assert({ actual, expected })
