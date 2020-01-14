import { createReadStream, promises } from "fs"
import {
  bufferToEtag,
  assertAndNormalizeFileUrl,
  readFileSystemNodeStat,
  readDirectory,
  urlToFileSystemPath,
} from "@jsenv/util"
import { convertFileSystemErrorToResponseProperties } from "./convertFileSystemErrorToResponseProperties.js"
import { urlToContentType } from "./urlToContentType.js"
import { jsenvContentTypeMap } from "./jsenvContentTypeMap.js"

const { readFile } = promises

export const serveFile = async (
  source,
  {
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

  try {
    const cacheWithMtime = cacheStrategy === "mtime"
    const cacheWithETag = cacheStrategy === "etag"
    const cachedDisabled = cacheStrategy === "none"

    const sourceStat = await readFileSystemNodeStat(sourceUrl)

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

      const directoryContentArray = await readDirectory(sourceUrl)
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
      const fileContentAsBuffer = await readFile(urlToFileSystemPath(sourceUrl))
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
