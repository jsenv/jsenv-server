if ("observable" in Symbol === false) {
  Symbol.observable = Symbol.for("observable")
}

export const createObservable = (subscribe) => {
  if (typeof subscribe !== "function") {
    throw new TypeError(`subscribe must be a function, got ${subscribe}`)
  }

  const observable = {
    [Symbol.observable]: () => observable,
    subscribe: ({
      next = () => {},
      error = (value) => {
        throw value
      },
      complete = () => {},
    }) => {
      let cleanup = () => {}
      const subscription = {
        closed: false,
        unsubscribe: () => {
          subscription.closed = true
          cleanup()
        },
      }

      const unsubscribeReturnValue = subscribe({
        next: (value) => {
          if (subscription.closed) return
          next(value)
        },
        error: (value) => {
          if (subscription.closed) return
          error(value)
        },
        complete: () => {
          if (subscription.closed) return
          complete()
        },
      })
      if (typeof unsubscribeReturnValue === "function") {
        cleanup = unsubscribeReturnValue
      }
      return subscription
    },
  }

  return observable
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
  if (isObservable(value)) {
    return value
  }

  return createObservable(({ next, complete }) => {
    next(value)
    const timer = setTimeout(() => {
      complete()
    })
    return () => {
      clearTimeout(timer)
    }
  })
}

export const createCompositeObservable = () => {
  const observables = new Set()
  const observers = new Set()

  const addObservable = (observable) => {
    if (observables.has(observable)) {
      return false
    }

    observables.add(observable)
    observers.forEach((observer) => {
      observer.observe(observable)
    })
    return true
  }

  const removeObservable = (observable) => {
    if (!observables.has(observable)) {
      return false
    }

    observables.delete(observable)
    observers.forEach((observer) => {
      observer.unobserve(observable)
    })
    return true
  }

  const compositeObservable = createObservable(
    ({ next = () => {}, error = () => {}, complete = () => {} }) => {
      let completeCount = 0

      const checkComplete = () => {
        if (completeCount === observables.size) {
          complete()
        }
      }

      const subscriptions = new Map()
      const observe = (observable) => {
        const subscription = observable.subscribe({
          next: (value) => {
            next(value)
          },
          error: (value) => {
            error(value)
          },
          complete: () => {
            subscriptions.delete(observable)
            completeCount++
            checkComplete()
          },
        })
        subscriptions.set(observable, subscription)
      }
      const unobserve = (observable) => {
        const subscription = subscriptions.get(observable)
        if (!subscription) {
          return
        }

        subscription.unsubscribe()
        subscriptions.delete(observable)
        checkComplete()
      }
      const observer = {
        observe,
        unobserve,
      }
      observers.add(observer)
      observables.forEach((observable) => {
        observe(observable)
      })

      return () => {
        observers.delete(observer)
        subscriptions.forEach((subscription) => {
          subscription.unsubscribe()
        })
        subscriptions.clear()
      }
    },
  )

  compositeObservable.addObservable = addObservable
  compositeObservable.removeObservable = removeObservable

  return compositeObservable
}
