import { parseMultipleHeader } from "./multiple-header.js"

export const parseAcceptHeader = (acceptHeader) => {
  const acceptHeaderObject = parseMultipleHeader(acceptHeader, {
    validateProperty: ({ name }) => {
      // read only q, anything else is ignored
      return name === "q"
    },
  })

  const accepts = []
  Object.keys(acceptHeaderObject).forEach((key) => {
    const acceptHeaderProperties = acceptHeaderObject[key]
    const type = key
    const quality = acceptHeaderProperties.q || 1
    accepts.push({ type, quality })
  })
  accepts.sort((a, b) => {
    return a.quality - b.quality
  })
  return accepts
}
