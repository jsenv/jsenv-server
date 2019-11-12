// https://github.com/jshttp/mime-db/blob/master/src/apache-types.json

import { extname } from "path"
import { jsenvContentTypeMap } from "./jsenvContentTypeMap.js"

export const filenameToContentType = (
  filename,
  contentTypeMap = jsenvContentTypeMap,
  contentTypeDefault = "application/octet-stream",
) => {
  if (typeof contentTypeMap !== "object") {
    throw new TypeError(`contentTypeMap must be an object, got ${contentTypeMap}`)
  }

  const extensionWithDot = extname(filename)

  if (!extensionWithDot || extensionWithDot === ".") {
    return contentTypeDefault
  }

  const extension = extensionWithDot.slice(1)
  const availableContentTypes = Object.keys(contentTypeMap)
  const contentTypeForExtension = availableContentTypes.find((contentTypeName) => {
    const contentType = contentTypeMap[contentTypeName]
    return contentType.extensions && contentType.extensions.indexOf(extension) > -1
  })
  return contentTypeForExtension || contentTypeDefault
}
