if ("observable" in Symbol === false) {
  Symbol.observable = Symbol.for("observable")
}

export const createObservable = ({ subscribe }) => {
  const observable = {
    [Symbol.observable]: () => observable,
    subscribe,
  }
  return observable
}

export const subscribe = (
  observable,
  {
    next = () => {},
    error = (value) => {
      throw value
    },
    complete = () => {},
  },
) => {
  const { subscribe } = observable[Symbol.observable]()
  const subscription = subscribe({
    next,
    error,
    complete,
  })
  return subscription || { unsubscribe: () => {} }
}

export const isObservable = (value) => {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value === "object" || typeof value === "function") {
    return Symbol.observable in value
  }

  return false
}

export const observableFromValue = (value) => {
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

//
