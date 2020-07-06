import { performance } from "perf_hooks"

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
]
