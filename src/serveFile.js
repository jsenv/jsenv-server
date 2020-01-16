import { createReadStream, promises } from "fs"
import {
  bufferToEtag,
  assertAndNormalizeFileUrl,
  readFileSystemNodeStat,
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

    const sourceStat = await createOperation({
      cancellationToken,
      start: () => readFileSystemNodeStat(sourceUrl),
    })

    if (sourceStat.isDirectory()) {
      if (canReadDirectory === false) {
        return {
          status: 403,
          statusText: "not allowed to read directory",
          headers: {
            ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
          },
        }
      }

      const directoryContentArray = await createOperation({
        cancellationToken,
        start: () => readDirectory(sourceUrl),
      })
      const directoryContentJson = JSON.stringify(directoryContentArray)

      return {
        status: 200,
        headers: {
          ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
          "content-type": "application/json",
          "content-length": directoryContentJson.length,
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
        },
      }
    }

    if (cacheWithETag) {
      const fileContentAsBuffer = await createOperation({
        cancellationToken,
        start: () => readFile(urlToFileSystemPath(sourceUrl)),
      })
      const fileContentEtag = bufferToEtag(fileContentAsBuffer)

      if ("if-none-match" in headers && headers["if-none-match"] === fileContentEtag) {
        return {
          status: 304,
          headers: {
            ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
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
