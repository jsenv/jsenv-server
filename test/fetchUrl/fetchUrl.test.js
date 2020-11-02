import { assert } from "@jsenv/assert"
import { resolveUrl, writeFile, ensureEmptyDirectory, urlToFileSystemPath } from "@jsenv/util"
import { fetchUrl, startServer } from "../../index.js"
import { createCancellationSource } from "@jsenv/cancellation"

const tempDirectoryUrl = resolveUrl("./temp/", import.meta.url)

// fetch text file
{
  await ensureEmptyDirectory(tempDirectoryUrl)
  const url = resolveUrl("file.txt", tempDirectoryUrl)
  const fileContent = "hello world"
  await writeFile(url, fileContent)

  const actual = await fetchUrl(url, { simplified: true, headers: { "cache-control": "no-cache" } })
  const expected = {
    url,
    status: 200,
    statusText: "OK",
    headers: {
      "cache-control": "no-store",
      "content-length": `${fileContent.length}`,
      "content-type": "text/plain",
    },
    body: fileContent,
  }
  assert({ actual, expected })
}

// fetching data url
{
  const jsData = `const a = true;`
  const jsBase64 = Buffer.from(jsData).toString("base64")
  const url = `data:text/javascript;base64,${jsBase64}`
  const actual = await fetchUrl(url, { simplified: true })
  const expected = {
    url,
    status: 200,
    statusText: "OK",
    headers: {
      "content-type": "text/javascript",
    },
    body: jsData,
  }
  assert({ actual, expected })
}

// fetch file but 404
{
  await ensureEmptyDirectory(tempDirectoryUrl)
  const url = resolveUrl("file.txt", tempDirectoryUrl)

  const actual = await fetchUrl(url, { simplified: true, headers: { "cache-control": "no-cache" } })
  const expected = {
    url,
    status: 404,
    statusText: `ENOENT: File not found at ${urlToFileSystemPath(url)}`,
    headers: {},
    body: "",
  }
  assert({ actual, expected })
}

// fetching http
{
  const body = "Hello world"
  const server = await startServer({
    requestToResponse: ({ method }) => {
      if (method !== "POST") return null

      return {
        status: 201,
        headers: {
          "content-type": "text/plain",
          "content-length": body.length,
        },
        body,
      }
    },
    logLevel: "warn",
    keepProcessAlive: false,
  })
  const url = server.origin

  const actual = await fetchUrl(url, { simplified: true, method: "POST" })
  const expected = {
    url: `${url}/`,
    status: 201,
    statusText: "Created",
    headers: {
      "connection": "close",
      "content-length": `${body.length}`,
      "content-type": "text/plain",
      "date": actual.headers.date,
    },
    body,
  }
  assert({ actual, expected })
  await server.stop()
}

// cancel while fetching http
{
  await ensureEmptyDirectory(tempDirectoryUrl)
  const server = await startServer({
    requestToResponse: async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 2000)
      })
    },
    logLevel: "warn",
    keepProcessAlive: false,
  })
  const url = server.origin
  const { cancel, token } = createCancellationSource()

  try {
    setTimeout(() => cancel("whatever"), 100)
    await fetchUrl(url, {
      cancellationToken: token,
      headers: { "cache-control": "no-cache" },
    })
    throw new Error("should throw")
  } catch (actual) {
    const expected = new Error("canceled because whatever")
    expected.name = "CANCEL_ERROR"
    expected.reason = "whatever"
    assert({ actual, expected })
  } finally {
    server.stop()
  }
}
