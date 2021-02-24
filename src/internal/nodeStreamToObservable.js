// https://github.com/jamestalmage/stream-to-observable/blob/master/index.js

import { createObservable } from "./observable.js"

export const nodeStreamToObservable = (nodeStream) => {
  return createObservable(({ next, error, complete }) => {
    // should we do nodeStream.resume() in case the stream was paused ?
    nodeStream.on("data", next)
    nodeStream.once("error", error)
    nodeStream.once("end", complete)

    const cleanup = () => {
      nodeStream.removeListener("data", next)
      nodeStream.removeListener("error", error)
      nodeStream.removeListener("end", complete)

      if (typeof nodeStream.abort === "function") {
        nodeStream.abort()
      } else {
        nodeStream.destroy()
      }
    }

    if (typeof nodeStream.once === "function") {
      nodeStream.once("abort", cleanup)
    }

    return cleanup
  })
}
