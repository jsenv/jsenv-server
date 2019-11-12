import { fileURLToPath } from "url"
import { createReadStream, readFile, readdir, stat } from "fs"
import { bufferToEtag } from "./internal/bufferToEtag.js"
import { convertFileSystemErrorToResponseProperties } from "./internal/convertFileSystemErrorToResponseProperties.js"
import { filenameToContentType } from "./filenameToContentType.js"
import { jsenvContentTypeMap } from "./jsenvContentTypeMap.js"

export const serveFile = async (
  path,
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

  if (path.startsWith("file:///")) {
    path = fileURLToPath(path)
  }

  try {
    const cacheWithMtime = cacheStrategy === "mtime"
    const cacheWithETag = cacheStrategy === "etag"
    const cachedDisabled = cacheStrategy === "none"

    const stat = await readFileStat(path)

    if (stat.isDirectory()) {
      if (canReadDirectory === false) {
        return {
          status: 403,
          statusText: "not allowed to read directory",
          headers: {
            ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
          },
        }
      }

      const files = await readDirectory(path)
      const filesAsJSON = JSON.stringify(files)

      return {
        status: 200,
        headers: {
          ...(cachedDisabled ? { "cache-control": "no-store" } : {}),
          "content-type": "application/json",
          "content-length": filesAsJSON.length,
        },
        body: filesAsJSON,
      }
    }

    if (cacheWithMtime) {
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

        const actualModificationDate = dateToSecondsPrecision(stat.mtime)
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
          "last-modified": dateToUTCString(stat.mtime),
          "content-length": stat.size,
          "content-type": ressourceToContentType(filesystemPath, contentTypeMap),
        },
        body: createReadStream(filesystemPath),
      }
    }

    if (cacheWithETag) {
      const buffer = await readFileAsBuffer(path)
      const eTag = bufferToEtag(buffer)

      if ("if-none-match" in headers && headers["if-none-match"] === eTag) {
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
          "content-length": stat.size,
          "content-type": ressourceToContentType(filesystemPath, contentTypeMap),
          etag: eTag,
        },
        body: buffer,
      }
    }

    return {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-length": stat.size,
        "content-type": filenameToContentType(path, contentTypeMap),
      },
      body: createReadStream(path),
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

const readFileAsBuffer = (path) =>
  new Promise((resolve, reject) => {
    readFile(path, (error, buffer) => {
      if (error) reject(error)
      else resolve(buffer)
    })
  })

const readFileStat = (path) =>
  new Promise((resolve, reject) => {
    stat(path, (error, stats) => {
      if (error) reject(error)
      else resolve(stats)
    })
  })

const readDirectory = (path) =>
  new Promise((resolve, reject) => {
    readdir(path, (error, value) => {
      if (error) reject(error)
      else resolve(value)
    })
  })
