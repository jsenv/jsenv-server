import { fileURLToPath } from "url"
import { readFileSync } from "fs"
import { assert } from "@jsenv/assert"
import { serveFile } from "../../index.js"

const testDirectoryUrl = new URL("./", import.meta.url)
const fileUrl = new URL("./file.js?ok=true", testDirectoryUrl)
const filePath = fileURLToPath(fileUrl)

const actual = await serveFile(filePath, {
  cacheStrategy: "etag",
})
const bodyAsBuffer = readFileSync(filePath)
const expected = {
  status: 200,
  headers: {
    "content-length": bodyAsBuffer.length,
    "content-type": "application/javascript",
    "etag": `"20-cXagzQt5IlWM1Fc0XXcmMtPeNKo"`,
  },
  body: bodyAsBuffer,
}
assert({ actual, expected })
