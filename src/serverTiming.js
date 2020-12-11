import { performance } from "perf_hooks"
import { parseMultipleHeader, stringifyMultipleHeader } from "./internal/multiple-header.js"

export const timeStart = (name) => {
  // as specified in https://w3c.github.io/server-timing/#the-performanceservertiming-interface
  // duration is a https://www.w3.org/TR/hr-time-2/#sec-domhighrestimestamp
  const startTimestamp = performance.now()
  const timeEnd = () => {
    const endTimestamp = performance.now()
    const timing = {
      [name]: endTimestamp - startTimestamp,
    }
    return timing
  }
  return timeEnd
}

export const timeFunction = (name, fn) => {
  const timeEnd = timeStart(name)
  const returnValue = fn()
  if (returnValue && typeof returnValue.then === "function") {
    return returnValue.then((value) => {
      return [timeEnd(), value]
    })
  }
  return [timeEnd(), returnValue]
}

// to predict order in chrome devtools we should put a,b,c,d,e or something
// because in chrome dev tools they are shown in alphabetic order
// also we should manipulate a timing object instead of a header to facilitate
// manipulation of the object so that the timing header response generation logic belongs to @jsenv/server
// so response can return a new timing object
// yes it's awful, feel free to PR with a better approach :)
export const timingToServerTimingResponseHeaders = (timing) => {
  const serverTimingValue = Object.keys(timing)
    .map((key, index) => {
      const time = timing[key]
      return `${letters[index] || "zz"};desc="${key}";dur=${time}`
    })
    .join(", ")

  return { "server-timing": serverTimingValue }
}

const letters = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
]

export const parseServerTimingHeader = (serverTimingHeaderString) => {
  const serverTimingHeaderObject = parseMultipleHeader(serverTimingHeaderString, {
    // (),/:;<=>?@[\]{}" Don't allowed
    // Minimal length is one symbol
    // Digits, alphabet characters,
    // and !#$%&'*+-.^_`|~ are allowed
    // https://www.w3.org/TR/2019/WD-server-timing-20190307/#the-server-timing-header-field
    // https://tools.ietf.org/html/rfc7230#section-3.2.6
    validateName: (name) => {
      const valid = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/gi.test(name)
      if (!valid) {
        console.warn(`server timing contains invalid symbols`)
        return false
      }
      return true
    },
    validateProperty: ({ name }) => {
      return name === "desc" || name === "dur"
    },
  })

  const serverTiming = {}
  Object.keys(serverTimingHeaderObject).forEach((key) => {
    const { desc, dur } = serverTimingHeaderObject[key]
    serverTiming[key] = {
      ...(desc ? { description: desc } : {}),
      ...(dur ? { duration: dur } : {}),
    }
  })
  return serverTiming
}

export const stringifyServerTimingHeader = (serverTimingHeader) => {
  return stringifyMultipleHeader(serverTimingHeader)
}
