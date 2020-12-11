import {
  resolveUrl,
  bufferToEtag,
  urlToFileSystemPath,
  ensureEmptyDirectory,
  writeFile,
  writeFileSystemNodeModificationTime,
  readFileSystemNodeModificationTime,
} from "@jsenv/util"
import { assert } from "@jsenv/assert"
import { serveFile } from "@jsenv/server"

const fixturesDirectoryUrl = resolveUrl("./fixtures/", import.meta.url)

// 200 on file
{
  await ensureEmptyDirectory(fixturesDirectoryUrl)
  const fileUrl = resolveUrl("./file.js", fixturesDirectoryUrl)
  const fileBuffer = Buffer.from(`const a = true`)
  await writeFile(fileUrl, fileBuffer)

  const request = { method: "GET", ressource: "/file.js?ok=true" }
  const actual = await serveFile(request, {
    rootDirectoryUrl: fixturesDirectoryUrl,
  })
  const expected = {
    status: 200,
    statusText: undefined,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/javascript",
      "content-length": fileBuffer.length,
    },
    body: actual.body,
    bodyEncoding: undefined,
    timing: {
      "file service>read file stat": actual.timing["file service>read file stat"],
    },
  }
  assert({ actual, expected })
}

// 404 if file is missing
{
  await ensureEmptyDirectory(fixturesDirectoryUrl)
  const fileUrl = resolveUrl("./toto", fixturesDirectoryUrl)
  const request = { method: "HEAD", ressource: "/toto" }
  const actual = await serveFile(request, {
    rootDirectoryUrl: fixturesDirectoryUrl,
  })
  const expected = {
    status: 404,
    statusText: `ENOENT: File not found at ${urlToFileSystemPath(fileUrl)}`,
  }
  assert({ actual, expected })
}

// 304 if file not modified (using etag)
{
  await ensureEmptyDirectory(fixturesDirectoryUrl)
  const fileUrl = resolveUrl("./file.js", fixturesDirectoryUrl)
  const fileBuffer = Buffer.from(`const a = true`)
  const fileBufferModified = Buffer.from(`const a = false`)

  await writeFile(fileUrl, fileBuffer)
  const request = { method: "GET", ressource: "/file.js" }
  const response = await serveFile(request, {
    rootDirectoryUrl: fixturesDirectoryUrl,
    etagEnabled: true,
  })
  {
    const actual = {
      status: response.status,
      headers: response.headers,
      body: response.body,
      timing: response.timing,
    }
    const expected = {
      status: 200,
      headers: {
        "cache-control": "private,max-age=0,must-revalidate",
        "content-type": "application/javascript",
        "content-length": fileBuffer.length,
        "etag": bufferToEtag(fileBuffer),
      },
      body: actual.body,
      timing: {
        "file service>read file stat": actual.timing["file service>read file stat"],
        "file service>generate file etag": actual.timing["file service>generate file etag"],
      },
    }
    assert({ actual, expected })
  }

  // do an other request with if-none-match
  const secondRequest = {
    ...request,
    headers: {
      "if-none-match": response.headers.etag,
    },
  }
  const secondResponse = await serveFile(secondRequest, {
    rootDirectoryUrl: fixturesDirectoryUrl,
    etagEnabled: true,
  })
  {
    const actual = {
      status: secondResponse.status,
      headers: secondResponse.headers,
    }
    const expected = {
      status: 304,
      headers: {
        "cache-control": "private,max-age=0,must-revalidate",
      },
    }
    assert({ actual, expected })
  }

  // modifiy the file content, then third request
  await writeFile(fileUrl, fileBufferModified)
  const thirdRequest = {
    ...secondRequest,
  }
  const thirdResponse = await serveFile(thirdRequest, {
    rootDirectoryUrl: fixturesDirectoryUrl,
    etagEnabled: true,
  })
  {
    const actual = {
      status: thirdResponse.status,
      headers: thirdResponse.headers,
    }
    const expected = {
      status: 200,
      headers: {
        "cache-control": "private,max-age=0,must-revalidate",
        "content-type": "application/javascript",
        "content-length": fileBufferModified.length,
        "etag": bufferToEtag(fileBufferModified),
      },
    }
    assert({ actual, expected })
  }
}

// 304 if file not mofified (using mtime)
{
  await ensureEmptyDirectory(fixturesDirectoryUrl)
  const fileUrl = resolveUrl("./file.js", fixturesDirectoryUrl)
  const fileBuffer = Buffer.from(`const a = true`)

  await writeFile(fileUrl, fileBuffer)
  const request = { method: "GET", ressource: "/file.js" }
  const response = await serveFile(request, {
    rootDirectoryUrl: fixturesDirectoryUrl,
    mtimeEnabled: true,
  })
  {
    const actual = {
      status: response.status,
      headers: response.headers,
      body: response.body,
      timing: response.timing,
    }
    const expected = {
      status: 200,
      headers: {
        "cache-control": "private,max-age=0,must-revalidate",
        "content-type": "application/javascript",
        "content-length": fileBuffer.length,
        "last-modified": new Date(await readFileSystemNodeModificationTime(fileUrl)).toUTCString(),
      },
      body: actual.body,
      timing: {
        "file service>read file stat": actual.timing["file service>read file stat"],
      },
    }
    assert({ actual, expected })
  }

  // do an other request with if-modified-since
  const secondRequest = {
    ...request,
    headers: {
      "if-modified-since": response.headers["last-modified"],
    },
  }
  const secondResponse = await serveFile(secondRequest, {
    rootDirectoryUrl: fixturesDirectoryUrl,
    mtimeEnabled: true,
  })
  {
    const actual = {
      status: secondResponse.status,
      headers: secondResponse.headers,
    }
    const expected = {
      status: 304,
      headers: {
        "cache-control": "private,max-age=0,must-revalidate",
      },
    }
    assert({ actual, expected })
  }

  // modifiy the file content, then third request
  await new Promise((resolve) => setTimeout(resolve, 1500)) // wait more than 1s
  await writeFileSystemNodeModificationTime(fileUrl, Date.now())

  const thirdRequest = {
    ...secondRequest,
  }
  const thirdResponse = await serveFile(thirdRequest, {
    rootDirectoryUrl: fixturesDirectoryUrl,
    mtimeEnabled: true,
  })
  {
    const actual = {
      status: thirdResponse.status,
      headers: thirdResponse.headers,
    }
    const expected = {
      status: 200,
      headers: {
        "cache-control": "private,max-age=0,must-revalidate",
        "content-type": "application/javascript",
        "content-length": fileBuffer.length,
        "last-modified": new Date(await readFileSystemNodeModificationTime(fileUrl)).toUTCString(),
      },
    }
    assert({ actual, expected })
  }
}

// 403 on directory
{
  await ensureEmptyDirectory(fixturesDirectoryUrl)
  const request = { method: "GET", ressource: "/" }
  const actual = await serveFile(request, { rootDirectoryUrl: fixturesDirectoryUrl })
  const expected = {
    status: 403,
    statusText: "not allowed to read directory",
    timing: {
      ["file service>read file stat"]: actual.timing["file service>read file stat"],
    },
  }
  assert({ actual, expected })
}

// 200 on directory when allowed
{
  const request = { method: "GET", ressource: "/" }
  const actual = await serveFile(request, {
    rootDirectoryUrl: fixturesDirectoryUrl,
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

// rootDirectoryUrl missing
{
  const request = { ressource: "/" }
  const actual = await serveFile(request)
  const expected = {
    status: 404,
    headers: {
      "content-type": "text/plain",
      "content-length": actual.headers["content-length"],
    },
    body: `Cannot serve file because rootDirectoryUrl parameter is not a directory url: undefined`,
  }
  assert({ actual, expected })
}

// wrong rootDirectoryUrl
{
  const request = { ressource: "/" }
  const actual = await serveFile(request, { rootDirectoryUrl: "https://example.com" })
  const expected = {
    status: 404,
    headers: {
      "content-type": "text/plain",
      "content-length": actual.headers["content-length"],
    },
    body: `Cannot serve file because rootDirectoryUrl parameter is not a directory url: https://example.com`,
  }
  assert({ actual, expected })
}

// 501 on POST
{
  const request = { method: "POST", ressource: "/" }
  const actual = await serveFile(request, { rootDirectoryUrl: fixturesDirectoryUrl })
  const expected = {
    status: 501,
  }
  assert({ actual, expected })
}
