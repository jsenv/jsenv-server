import { resolveUrl, readFile, bufferToEtag } from "@jsenv/util"
import { assert } from "@jsenv/assert"
import { serveFile } from "../../index.js"

const testDirectoryUrl = resolveUrl("./", import.meta.url)
const sourceUrl = resolveUrl("./file.js?ok=true", testDirectoryUrl)

const actual = await serveFile(sourceUrl, {
  cacheStrategy: "etag",
})
const sourceBuffer = Buffer.from(await readFile(sourceUrl))
const expected = {
  status: 200,
  headers: {
    "content-length": sourceBuffer.length,
    "content-type": "application/javascript",
    "etag": bufferToEtag(sourceBuffer),
  },
  body: sourceBuffer,
  timing: {
    "file service>read file stat": actual.timing["file service>read file stat"],
    "file service>read file": actual.timing["file service>read file"],
    "file service>generate file etag": actual.timing["file service>generate file etag"],
  },
}
assert({ actual, expected })
