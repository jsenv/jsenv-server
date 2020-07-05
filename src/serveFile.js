import { createReadStream, promises, statSync } from "fs"
import {
  bufferToEtag,
  assertAndNormalizeFileUrl,
  readDirectory,
  urlToFileSystemPath,
} from "@jsenv/util"
import { createCancellationToken, createOperation } from "@jsenv/cancellation"
import { convertFileSystemErrorToResponseProperties } from "./convertFileSystemErrorToResponseProperties.js"
import { urlToContentType } from "./urlToContentType.js"
import { jsenvContentTypeMap } from "./jsenvContentTypeMap.js"

const { readFile } = promises

export const serveFile = async (
  source,
  {
    cancellationToken = createCancellationToken(),
    method = "GET",
    headers = {},
    canReadDirectory = false,
    cacheStrategy = "etag",
    contentTypeMap = jsenvContentTypeMap,
    sendServerTiming = false,
  } = {},
) => {
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: 501,
    }
  }

  const sourceUrl = assertAndNormalizeFileUrl(source)
  const clientCacheDisabled = headers["cache-control"] === "no-cache"

  try {
    const cacheWithMtime = !clientCacheDisabled && cacheStrategy === "mtime"
    const cacheWithETag = !clientCacheDisabled && cacheStrategy === "etag"
    const cachedDisabled = clientCacheDisabled || cacheStrategy === "none"

    const [readStatTime, sourceStat] = await measureFunctionDuration(() =>
      statSync(urlToFileSystemPath(sourceUrl)),
    )
    const readStatTiming = {
      "read file stat": readStatTime,
    }

    if (sourceStat.isDirectory()) {
      if (canReadDirectory === false) {
        return {
          status: 403,
          statusText: "not allowed to read directory",
          headers: {
            ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
            ...(sendServerTiming ? timingToServerTimingResponseHeaders(readStatTiming) : {}),
          },
        }
      }

      const [readDirectoryTime, directoryContentArray] = await measureFunctionDuration(() =>
        createOperation({
          cancellationToken,
          start: () => readDirectory(sourceUrl),
        }),
      )
      const readDirectoryTiming = { "read directory": readDirectoryTime }
      const directoryContentJson = JSON.stringify(directoryContentArray)

      return {
        status: 200,
        headers: {
          ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
          "content-type": "application/json",
          "content-length": directoryContentJson.length,
          ...(sendServerTiming
            ? timingToServerTimingResponseHeaders({
                ...readStatTiming,
                ...readDirectoryTiming,
              })
            : {}),
        },
        body: directoryContentJson,
      }
    }

    // not a file, give up
    if (!sourceStat.isFile()) {
      return {
        status: 404,
        headers: {
          ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
          ...(sendServerTiming ? timingToServerTimingResponseHeaders(readStatTiming) : {}),
        },
      }
    }

    if (cacheWithETag) {
      const [readFileTime, fileContentAsBuffer] = await measureFunctionDuration(() =>
        createOperation({
          cancellationToken,
          start: () => readFile(urlToFileSystemPath(sourceUrl)),
        }),
      )
      const readFileTiming = { "read file": readFileTime }
      const [computeFileEtagTime, fileContentEtag] = await measureFunctionDuration(() =>
        bufferToEtag(fileContentAsBuffer),
      )
      const computeEtagTiming = { "generate file etag": computeFileEtagTime }

      if ("if-none-match" in headers && headers["if-none-match"] === fileContentEtag) {
        return {
          status: 304,
          headers: {
            ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
            ...(sendServerTiming
              ? timingToServerTimingResponseHeaders({
                  ...readStatTiming,
                  ...readFileTiming,
                  ...computeEtagTiming,
                })
              : {}),
          },
        }
      }

      return {
        status: 200,
        headers: {
          ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
          "content-length": sourceStat.size,
          "content-type": urlToContentType(sourceUrl, contentTypeMap),
          "etag": fileContentEtag,
          ...(sendServerTiming
            ? timingToServerTimingResponseHeaders({
                ...readStatTiming,
                ...readFileTiming,
                ...computeEtagTiming,
              })
            : {}),
        },
        body: fileContentAsBuffer,
      }
    }

    if (cacheWithMtime && "if-modified-since" in headers) {
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
          headers: {
            ...(sendServerTiming ? timingToServerTimingResponseHeaders(readStatTiming) : {}),
          },
        }
      }
    }

    return {
      status: 200,
      headers: {
        ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
        ...(cacheWithMtime ? { "last-modified": dateToUTCString(sourceStat.mtime) } : {}),
        "content-length": sourceStat.size,
        "content-type": urlToContentType(sourceUrl, contentTypeMap),
        ...(sendServerTiming ? timingToServerTimingResponseHeaders(readStatTiming) : {}),
      },
      body: createReadStream(urlToFileSystemPath(sourceUrl)),
    }
  } catch (e) {
    return convertFileSystemErrorToResponseProperties(e)
  }
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toUTCString
const dateToUTCString = (date) => date.toUTCString()

const dateToSecondsPrecision = (date) => {
  const dateWithSecondsPrecision = new Date(date)
  dateWithSecondsPrecision.setMilliseconds(0)
  return dateWithSecondsPrecision
}

const timingToServerTimingResponseHeaders = (timing) => {
  const serverTimingValue = Object.keys(timing)
    .map((key) => {
      const time = timing[key]
      return `${key.replace(/ /g, "_")};desc=${JSON.stringify(key)};dur=${time}`
    })
    .join(", ")

  return { "server-timing": serverTimingValue }
}

const measureFunctionDuration = async (fn) => {
  const startTime = Date.now()
  const value = await fn()
  const endTime = Date.now()
  return [endTime - startTime, value]
}
