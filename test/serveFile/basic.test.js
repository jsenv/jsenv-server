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
}
assert({ actual, expected })
