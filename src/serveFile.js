import { createReadStream, promises, statSync } from "fs"
import {
  assertAndNormalizeDirectoryUrl,
  resolveUrl,
  resolveDirectoryUrl,
  bufferToEtag,
  readDirectory,
  urlToFileSystemPath,
  urlToRelativeUrl,
} from "@jsenv/util"
import { createOperation } from "@jsenv/cancellation"
import { negotiateContentType } from "./negotiateContentType.js"
import { timeFunction } from "./serverTiming.js"
import { convertFileSystemErrorToResponseProperties } from "./convertFileSystemErrorToResponseProperties.js"
import { urlToContentType } from "./urlToContentType.js"
import { jsenvContentTypeMap } from "./jsenvContentTypeMap.js"
import { composeResponse } from "./composeResponse.js"
import { negotiateContentEncoding } from "./negotiateContentEncoding.js"

const { readFile } = promises

const ETAG_CACHE = new Map()
const ETAG_CACHE_MAX_SIZE = 500

export const serveFile = async (
  request,
  {
    rootDirectoryUrl,
    contentTypeMap = jsenvContentTypeMap,
    etagEnabled = false,
    etagCacheDisabled = false,
    mtimeEnabled = false,
    compressionEnabled = false,
    compressionSizeThreshold = 1024,
    cacheControl = etagEnabled || mtimeEnabled ? "private,max-age=0,must-revalidate" : "no-store",
    canReadDirectory = false,
    readableStreamLifetimeInSeconds = 120,
  } = {},
) => {
  try {
    rootDirectoryUrl = assertAndNormalizeDirectoryUrl(rootDirectoryUrl)
  } catch (e) {
    const body = `Cannot serve file because rootDirectoryUrl parameter is not a directory url: ${rootDirectoryUrl}`
    return {
      status: 404,
      headers: {
        "content-type": "text/plain",
        "content-length": Buffer.byteLength(body),
      },
      body,
    }
  }
  // here you might be tempted to add || cacheControl === 'no-cache'
  // but no-cache means ressource can be cache but must be revalidated (yeah naming is strange)
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#Cacheability
  if (cacheControl === "no-store") {
    if (etagEnabled) {
      console.warn(`cannot enable etag when cache-control is ${cacheControl}`)
      etagEnabled = false
    }
    if (mtimeEnabled) {
      console.warn(`cannot enable mtime when cache-control is ${cacheControl}`)
      mtimeEnabled = false
    }
  }
  if (etagEnabled && mtimeEnabled) {
    console.warn(`cannot enable both etag and mtime, mtime disabled in favor of etag.`)
    mtimeEnabled = false
  }

  const { method, ressource } = request
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: 501,
    }
  }

  let sourceUrl = resolveUrl(ressource.slice(1), rootDirectoryUrl)
  const sourceFileSystemPath = urlToFileSystemPath(sourceUrl)

  try {
    const [readStatTiming, sourceStat] = await timeFunction("file service>read file stat", () =>
      statSync(sourceFileSystemPath),
    )

    if (sourceStat.isDirectory()) {
      sourceUrl = resolveDirectoryUrl(ressource.slice(1), rootDirectoryUrl)

      if (canReadDirectory === false) {
        return {
          status: 403,
          statusText: "not allowed to read directory",
          timing: readStatTiming,
        }
      }

      const [readDirectoryTiming, directoryContentArray] = await timeFunction(
        "file service>read directory",
        () =>
          createOperation({
            cancellationToken: request.cancellationToken,
            start: () => readDirectory(sourceUrl),
          }),
      )

      const responseProducers = {
        "application/json": () => {
          const directoryContentJson = JSON.stringify(directoryContentArray)
          return {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": directoryContentJson.length,
            },
            body: directoryContentJson,
            timing: {
              ...readStatTiming,
              ...readDirectoryTiming,
            },
          }
        },
        "text/html": () => {
          const directoryAsHtml = `<!DOCTYPE html>
<html>
  <head>
    <title>Directory explorer</title>
    <meta charset="utf-8" />
    <link rel="icon" href="data:," />
  </head>

  <body>
    <h1>Content of directory ${sourceUrl}</h1>
    <ul>
      ${directoryContentArray.map((filename) => {
        const fileUrl = resolveUrl(filename, sourceUrl)
        const fileUrlRelativeToServer = urlToRelativeUrl(fileUrl, rootDirectoryUrl)
        return `<li>
        <a href="/${fileUrlRelativeToServer}">${fileUrlRelativeToServer}</a>
      </li>`
      }).join(`
      `)}
    </ul>
  </body>
</html>`

          return {
            status: 200,
            headers: {
              "content-type": "text/html",
              "content-length": Buffer.byteLength(directoryAsHtml),
            },
            body: directoryAsHtml,
          }
        },
      }
      const bestContentType = negotiateContentType(request, Object.keys(responseProducers))
      return responseProducers[bestContentType || "application/json"]()
    }

    // not a file, give up
    if (!sourceStat.isFile()) {
      return {
        status: 404,
        timing: readStatTiming,
      }
    }

    const clientCacheResponse = await getClientCacheResponse(request, {
      etagEnabled,
      etagCacheDisabled,
      mtimeEnabled,
      sourceStat,
      sourceUrl,
    })

    // send 304 (redirect response to client cache)
    // because the response body does not have to be transmitted
    if (clientCacheResponse.status === 304) {
      return composeResponse(
        {
          timing: readStatTiming,
          headers: {
            ...(cacheControl ? { "cache-control": cacheControl } : {}),
          },
        },
        clientCacheResponse,
      )
    }

    let response
    if (compressionEnabled && sourceStat.size >= compressionSizeThreshold) {
      const compressedResponse = await getCompressedResponse(request, {
        sourceUrl,
        contentTypeMap,
      })
      if (compressedResponse) {
        response = compressedResponse
      }
    }
    if (!response) {
      response = await getRawResponse(request, {
        sourceStat,
        sourceUrl,
        contentTypeMap,
      })
    }

    if (response.body) {
      // do not keep readable stream opened on that file
      // otherwise file is kept open forever.
      // moreover it will prevent to unlink the file on windows.
      if (clientCacheResponse.body) {
        response.body.destroy()
      } else if (readableStreamLifetimeInSeconds && readableStreamLifetimeInSeconds !== Infinity) {
        // safe measure, ensure the readable stream gets used in the next ${readableStreamLifetimeInSeconds} otherwise destroys it
        const timeout = setTimeout(() => {
          console.warn(
            `readable stream on ${sourceUrl} still unused after ${readableStreamLifetimeInSeconds} seconds -> destroying it to release file handle`,
          )
          response.body.destroy()
        }, readableStreamLifetimeInSeconds * 1000)
        onceReadableStreamUsedOrClosed(response.body, () => {
          clearTimeout(timeout)
        })
      }
    }

    return composeResponse(
      {
        timing: readStatTiming,
        headers: {
          ...(cacheControl ? { "cache-control": cacheControl } : {}),
          // even if client cache is disabled, server can still
          // send his own cache control but client should just ignore it
          // and keep sending cache-control: 'no-store'
          // if not, uncomment the line below to preserve client
          // desire to ignore cache
          // ...(headers["cache-control"] === "no-store" ? { "cache-control": "no-store" } : {}),
        },
      },
      response,
      clientCacheResponse,
    )
  } catch (e) {
    return convertFileSystemErrorToResponseProperties(e)
  }
}

const getClientCacheResponse = async (
  request,
  { etagEnabled, etagCacheDisabled, mtimeEnabled, sourceStat, sourceUrl },
) => {
  // here you might be tempted to add || headers["cache-control"] === "no-cache"
  // but no-cache means ressource can be cache but must be revalidated (yeah naming is strange)
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#Cacheability

  const { headers = {} } = request
  if (
    headers["cache-control"] === "no-store" ||
    // let's disable it on no-cache too (https://github.com/jsenv/jsenv-server/issues/17)
    headers["cache-control"] === "no-cache"
  ) {
    return { status: 200 }
  }

  if (etagEnabled) {
    return getEtagResponse(request, {
      etagCacheDisabled,
      sourceStat,
      sourceUrl,
    })
  }

  if (mtimeEnabled) {
    return getMtimeResponse(request, {
      sourceStat,
    })
  }

  return { status: 200 }
}

const getEtagResponse = async (request, { etagCacheDisabled, sourceUrl, sourceStat }) => {
  const [computeEtagTiming, fileContentEtag] = await timeFunction(
    "file service>generate file etag",
    () => computeEtag(request, { etagCacheDisabled, sourceUrl, sourceStat }),
  )

  const { headers = {} } = request
  const requestHasIfNoneMatchHeader = "if-none-match" in headers
  if (requestHasIfNoneMatchHeader && headers["if-none-match"] === fileContentEtag) {
    return {
      status: 304,
      timing: computeEtagTiming,
    }
  }

  return {
    status: 200,
    headers: {
      etag: fileContentEtag,
    },
    timing: computeEtagTiming,
  }
}

const computeEtag = async (request, { etagCacheDisabled, sourceUrl, sourceStat }) => {
  if (!etagCacheDisabled) {
    const etagCacheEntry = ETAG_CACHE.get(sourceUrl)
    if (etagCacheEntry && fileStatAreTheSame(etagCacheEntry.sourceStat, sourceStat)) {
      return etagCacheEntry.eTag
    }
  }
  const fileContentAsBuffer = await createOperation({
    cancellationToken: request.cancellationToken,
    start: () => readFile(urlToFileSystemPath(sourceUrl)),
  })
  const eTag = bufferToEtag(fileContentAsBuffer)
  if (!etagCacheDisabled) {
    if (ETAG_CACHE.size >= ETAG_CACHE_MAX_SIZE) {
      const firstKey = Array.from(ETAG_CACHE.keys())[0]
      ETAG_CACHE.delete(firstKey)
    }
    ETAG_CACHE.set(sourceUrl, { sourceStat, eTag })
  }
  return eTag
}

// https://nodejs.org/api/fs.html#fs_class_fs_stats
const fileStatAreTheSame = (leftFileStat, rightFileStat) => {
  return fileStatKeysToCompare.every((keyToCompare) => {
    const leftValue = leftFileStat[keyToCompare]
    const rightValue = rightFileStat[keyToCompare]
    return leftValue === rightValue
  })
}
const fileStatKeysToCompare = [
  // mtime the the most likely to change, check it first
  "mtimeMs",
  "size",
  "ctimeMs",
  "ino",
  "mode",
  "uid",
  "gid",
  "blksize",
]

const getMtimeResponse = async (request, { sourceStat }) => {
  const { headers = {} } = request
  if ("if-modified-since" in headers) {
    let cachedModificationDate
    try {
      cachedModificationDate = new Date(headers["if-modified-since"])
    } catch (e) {
      return {
        status: 400,
        statusText: "if-modified-since header is not a valid date",
      }
    }

    const actualModificationDate = dateToSecondsPrecision(sourceStat.mtime)
    if (Number(cachedModificationDate) >= Number(actualModificationDate)) {
      return {
        status: 304,
      }
    }
  }

  return {
    status: 200,
    headers: {
      "last-modified": dateToUTCString(sourceStat.mtime),
    },
  }
}

const getCompressedResponse = async (request, { sourceUrl, contentTypeMap }) => {
  const acceptedCompressionFormat = negotiateContentEncoding(
    request,
    Object.keys(availableCompressionFormats),
  )
  if (!acceptedCompressionFormat) {
    return null
  }

  const fileReadableStream = fileUrlToReadableStream(sourceUrl)
  const body = await availableCompressionFormats[acceptedCompressionFormat](fileReadableStream)

  return {
    status: 200,
    headers: {
      "content-type": urlToContentType(sourceUrl, contentTypeMap),
      "content-encoding": acceptedCompressionFormat,
      "vary": "accept-encoding",
    },
    body,
  }
}

const fileUrlToReadableStream = (fileUrl) => {
  return createReadStream(urlToFileSystemPath(fileUrl), { emitClose: true })
}

const availableCompressionFormats = {
  br: async (fileReadableStream) => {
    const { createBrotliCompress } = await import("zlib")
    return fileReadableStream.pipe(createBrotliCompress())
  },
  deflate: async (fileReadableStream) => {
    const { createDeflate } = await import("zlib")
    return fileReadableStream.pipe(createDeflate())
  },
  gzip: async (fileReadableStream) => {
    const { createGzip } = await import("zlib")
    return fileReadableStream.pipe(createGzip())
  },
}

const getRawResponse = async (request, { sourceStat, sourceUrl, contentTypeMap }) => {
  return {
    status: 200,
    headers: {
      "content-type": urlToContentType(sourceUrl, contentTypeMap),
      "content-length": sourceStat.size,
    },
    body: fileUrlToReadableStream(sourceUrl),
  }
}

const onceReadableStreamUsedOrClosed = (readableStream, callback) => {
  const dataOrCloseCallback = () => {
    readableStream.removeListener("data", dataOrCloseCallback)
    readableStream.removeListener("close", dataOrCloseCallback)
    callback()
  }
  readableStream.on("data", dataOrCloseCallback)
  readableStream.on("close", dataOrCloseCallback)
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toUTCString
const dateToUTCString = (date) => date.toUTCString()

const dateToSecondsPrecision = (date) => {
  const dateWithSecondsPrecision = new Date(date)
  dateWithSecondsPrecision.setMilliseconds(0)
  return dateWithSecondsPrecision
}
