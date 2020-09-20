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

export const serveFile = async (
  source,
  {
    cancellationToken = createCancellationToken(),
    method = "GET",
    headers = {},
    contentTypeMap = jsenvContentTypeMap,
    etagEnabled = false,
    mtimeEnabled = false,
    cacheControl = etagEnabled || mtimeEnabled ? "private" : "no-store",
    canReadDirectory = false,
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
    return composeResponse(
      {
        timing: readStatTiming,
        headers: {
          ...(cacheControl ? { "cache-control": cacheControl } : {}),
          // even if client cache is disabled, server can still
          // send his own cache control but client should just ignore it
          // and keep sending cache-control: 'no-store'
          // if not, uncomment the line below to preserve client
          // desired to ignore cache
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

const getClientCacheResponse = async ({ headers, etagEnabled, mtimeEnabled, ...rest }) => {
  // here you might be tempted to add || headers["cache-control"] === "no-cache"
  // but no-cache means ressource can be cache but must be revalidated (yeah naming is strange)
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#Cacheability
  if (headers["cache-control"] === "no-store") {
    return { status: 200 }
  }

  if (etagEnabled) {
    return getEtagResponse({
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

const getEtagResponse = async ({ cancellationToken, sourceUrl, headers }) => {
  const [readFileTiming, fileContentAsBuffer] = await timeFunction("file service>read file", () =>
    createOperation({
      cancellationToken,
      start: () => readFile(urlToFileSystemPath(sourceUrl)),
    }),
  )
  const [computeEtagTiming, fileContentEtag] = await timeFunction(
    "file service>generate file etag",
    () => bufferToEtag(fileContentAsBuffer),
  )

  if ("if-none-match" in headers && headers["if-none-match"] === fileContentEtag) {
    return {
      status: 304,
      timing: {
        ...readFileTiming,
        ...computeEtagTiming,
      },
    }
  }

  return {
    status: 200,
    headers: {
      etag: fileContentEtag,
    },
    body: fileContentAsBuffer,
    timing: {
      ...readFileTiming,
      ...computeEtagTiming,
    },
  }
}

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
    body: createReadStream(urlToFileSystemPath(sourceUrl)),
  }
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toUTCString
const dateToUTCString = (date) => date.toUTCString()

const dateToSecondsPrecision = (date) => {
  const dateWithSecondsPrecision = new Date(date)
  dateWithSecondsPrecision.setMilliseconds(0)
  return dateWithSecondsPrecision
}
