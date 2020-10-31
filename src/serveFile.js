import { createReadStream, promises, statSync } from "fs"
import {
  bufferToEtag,
  assertAndNormalizeFileUrl,
  readDirectory,
  urlToFileSystemPath,
} from "@jsenv/util"
import { createCancellationToken, createOperation } from "@jsenv/cancellation"
import { timeFunction } from "./serverTiming.js"
import { convertFileSystemErrorToResponseProperties } from "./convertFileSystemErrorToResponseProperties.js"
import { urlToContentType } from "./urlToContentType.js"
import { jsenvContentTypeMap } from "./jsenvContentTypeMap.js"
import { composeResponse } from "./composeResponse.js"

const { readFile } = promises

const ETAG_CACHE = new Map()
const ETAG_CACHE_MAX_SIZE = 500

export const serveFile = async (
  source,
  {
    cancellationToken = createCancellationToken(),
    method = "GET",
    headers = {},
    contentTypeMap = jsenvContentTypeMap,
    etagEnabled = false,
    etagCacheDisabled = false,
    mtimeEnabled = false,
    cacheControl = etagEnabled || mtimeEnabled ? "private,max-age=0,must-revalidate" : "no-store",
    canReadDirectory = false,
    readableStreamLifetimeInSeconds = 5,
  } = {},
) => {
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

  if (method !== "GET" && method !== "HEAD") {
    return {
      status: 501,
    }
  }

  const sourceUrl = assertAndNormalizeFileUrl(source)

  try {
    const [readStatTiming, sourceStat] = await timeFunction("file service>read file stat", () =>
      statSync(urlToFileSystemPath(sourceUrl)),
    )

    const clientCacheResponse = await getClientCacheResponse({
      cancellationToken,
      etagEnabled,
      etagCacheDisabled,
      mtimeEnabled,
      method,
      headers,
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

    const rawResponse = await getRawResponse({
      cancellationToken,
      canReadDirectory,
      contentTypeMap,
      method,
      headers,
      sourceStat,
      sourceUrl,
    })

    // do not keep readable stream opened on that file
    // otherwise file is kept open forever.
    // moreover it will prevent to unlink the file on windows.
    if (clientCacheResponse.body) {
      rawResponse.body.destroy()
    } else if (readableStreamLifetimeInSeconds && readableStreamLifetimeInSeconds !== Infinity) {
      // safe measure, ensure the readable stream gets used in the next ${readableStreamLifetimeInSeconds} otherwise destroys it
      const timeout = setTimeout(() => {
        console.warn(
          `readable stream on ${sourceUrl} still unused after ${readableStreamLifetimeInSeconds} seconds -> destroying it to release file handle`,
        )
        rawResponse.body.destroy()
      }, readableStreamLifetimeInSeconds * 1000)
      onceReadableStreamUsedOrClosed(rawResponse.body, () => {
        clearTimeout(timeout)
      })
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
      rawResponse,
      clientCacheResponse,
    )
  } catch (e) {
    return convertFileSystemErrorToResponseProperties(e)
  }
}

const getClientCacheResponse = async ({
  headers,
  etagEnabled,
  etagCacheDisabled,
  mtimeEnabled,
  ...rest
}) => {
  // here you might be tempted to add || headers["cache-control"] === "no-cache"
  // but no-cache means ressource can be cache but must be revalidated (yeah naming is strange)
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#Cacheability

  if (
    headers["cache-control"] === "no-store" ||
    // let's disable it on no-cache too (https://github.com/jsenv/jsenv-server/issues/17)
    headers["cache-control"] === "no-cache"
  ) {
    return { status: 200 }
  }

  if (etagEnabled) {
    return getEtagResponse({
      etagCacheDisabled,
      headers,
      ...rest,
    })
  }

  if (mtimeEnabled) {
    return getMtimeResponse({
      headers,
      ...rest,
    })
  }

  return { status: 200 }
}

const getEtagResponse = async ({
  etagCacheDisabled,
  cancellationToken,
  sourceUrl,
  sourceStat,
  headers,
}) => {
  const [computeEtagTiming, fileContentEtag] = await timeFunction(
    "file service>generate file etag",
    () => computeEtag({ cancellationToken, etagCacheDisabled, headers, sourceUrl, sourceStat }),
  )

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

const computeEtag = async ({ cancellationToken, etagCacheDisabled, sourceUrl, sourceStat }) => {
  if (!etagCacheDisabled) {
    const etagCacheEntry = ETAG_CACHE.get(sourceUrl)
    if (etagCacheEntry && fileStatAreTheSame(etagCacheEntry.sourceStat, sourceStat)) {
      return etagCacheEntry.eTag
    }
  }
  const fileContentAsBuffer = await createOperation({
    cancellationToken,
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

const getMtimeResponse = async ({ sourceStat, headers }) => {
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

const getRawResponse = async ({
  cancellationToken,
  sourceStat,
  sourceUrl,
  canReadDirectory,
  contentTypeMap,
}) => {
  if (sourceStat.isDirectory()) {
    if (canReadDirectory === false) {
      return {
        status: 403,
        statusText: "not allowed to read directory",
      }
    }

    const [readDirectoryTiming, directoryContentArray] = await timeFunction(
      "file service>read directory",
      () =>
        createOperation({
          cancellationToken,
          start: () => readDirectory(sourceUrl),
        }),
    )
    const directoryContentJson = JSON.stringify(directoryContentArray)

    return {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": directoryContentJson.length,
      },
      body: directoryContentJson,
      timing: readDirectoryTiming,
    }
  }

  // not a file, give up
  if (!sourceStat.isFile()) {
    return {
      status: 404,
    }
  }

  return {
    status: 200,
    headers: {
      "content-type": urlToContentType(sourceUrl, contentTypeMap),
      "content-length": sourceStat.size,
    },
    body: createReadStream(urlToFileSystemPath(sourceUrl), { emitClose: true }),
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
