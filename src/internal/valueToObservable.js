import { createObservable } from "./observable.js"

export const valueToObservable = (value) => {
  return createObservable({
    subscribe: ({ next, complete }) => {
      next(value)
      const timer = setTimeout(() => {
        complete()
      })
      return {
        unsubscribe: () => {
          clearTimeout(timer)
        },
      }
    },
  })
}
