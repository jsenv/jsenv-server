import { createRequire } from "module"

const require = createRequire(import.meta.url)
const nodeFetch = require("node-fetch")

export const fetch = async (url, options) => {
  const response = await nodeFetch(url, options)

  const headers = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })

  return {
    url: response.url,
    status: response.status,
    headers,
    body: await response.text(),
  }
}
