import { resolveUrl, readFile } from "@jsenv/util"
import { assert } from "@jsenv/assert"
import { serveFile } from "../../index.js"

// const isWindows = process.platform === "win32"
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
    "etag": `"20-cXagzQt5IlWM1Fc0XXcmMtPeNKo"`,
  },
  body: sourceBuffer,
}
assert({ actual, expected })
