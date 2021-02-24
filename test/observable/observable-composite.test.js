import {
  createObservable,
  createCompositeObservable,
} from "@jsenv/server/src/internal/observable.js"
import { assert } from "@jsenv/assert"

const createObservableSource = () => {
  const observable = createObservable((callbacks) => {
    Object.assign(observable, callbacks)
  })
  return observable
}

// notified from many observables
{
  const sourceA = createObservableSource()
  const sourceB = createObservableSource()
  const sourceComposite = createCompositeObservable()
  sourceComposite.addObservable(sourceA)
  sourceComposite.addObservable(sourceB)
  const nextCalls = []
  sourceComposite.subscribe({
    next: (value) => {
      nextCalls.push(value)
    },
  })
  const nextCallsBefore = nextCalls.slice()
  sourceA.next("a")
  sourceB.next("b")

  const actual = {
    nextCallsBefore,
    nextCalls,
  }
  const expected = {
    nextCallsBefore: [],
    nextCalls: ["a", "b"],
  }
  assert({ actual, expected })
}

// can add after subscribe
{
  const source = createObservableSource()
  const sourceComposite = createCompositeObservable()
  const nextCalls = []
  sourceComposite.subscribe({
    next: (value) => {
      nextCalls.push(value)
    },
  })

  sourceComposite.addObservable(source)

  const nextCallsBefore = nextCalls.slice()
  source.next("foo")

  const actual = {
    nextCallsBefore,
    nextCalls,
  }
  const expected = {
    nextCallsBefore: [],
    nextCalls: ["foo"],
  }
  assert({ actual, expected })
}

// can remove after subscribe
{
  const source = createObservableSource()
  const sourceComposite = createCompositeObservable()
  sourceComposite.addObservable(source)
  const nextCalls = []
  sourceComposite.subscribe({
    next: (value) => {
      nextCalls.push(value)
    },
  })
  sourceComposite.removeObservable(source)

  const nextCallsBefore = nextCalls.slice()
  source.next("foo")

  const actual = {
    nextCallsBefore,
    nextCalls,
  }
  const expected = {
    nextCallsBefore: [],
    nextCalls: [],
  }
  assert({ actual, expected })
}

// subscription complete when all source are complete
{
  const sourceA = createObservableSource()
  const sourceB = createObservableSource()
  const sourceComposite = createCompositeObservable()
  sourceComposite.addObservable(sourceA)
  sourceComposite.addObservable(sourceB)
  let completeCalled = false
  sourceComposite.subscribe({
    complete: () => {
      completeCalled = true
    },
  })

  const completeCalledBefore = completeCalled
  sourceA.complete()
  const completeCalledAfterSourceAComplete = completeCalled
  sourceB.complete()
  const completeCalledAfterAllSourceComplete = completeCalled

  const actual = {
    completeCalledBefore,
    completeCalledAfterSourceAComplete,
    completeCalledAfterAllSourceComplete,
  }
  const expected = {
    completeCalledBefore: false,
    completeCalledAfterSourceAComplete: false,
    completeCalledAfterAllSourceComplete: true,
  }
  assert({ actual, expected })
}

// subscription complete when last non completed source is removed
{
  const sourceA = createObservableSource()
  const sourceB = createObservableSource()
  const sourceComposite = createCompositeObservable()
  sourceComposite.addObservable(sourceA)
  sourceComposite.addObservable(sourceB)
  let completeCalled = false
  sourceComposite.subscribe({
    complete: () => {
      completeCalled = true
    },
  })

  const completeCalledBefore = completeCalled
  sourceA.complete()
  const completeCalledAfterSourceAComplete = completeCalled
  sourceComposite.removeObservable(sourceB)
  const completeCalledAfterSourceBRemoved = completeCalled

  const actual = {
    completeCalledBefore,
    completeCalledAfterSourceAComplete,
    completeCalledAfterSourceBRemoved,
  }
  const expected = {
    completeCalledBefore: false,
    completeCalledAfterSourceAComplete: false,
    completeCalledAfterSourceBRemoved: true,
  }
  assert({ actual, expected })
}

// subscription complete when all source are complete
{
  const observable = createObservable(() => {})
  const sourceComposite = createCompositeObservable()
  sourceComposite.addObservable(observable)
  let completeCalled = false
  sourceComposite.subscribe({
    complete: () => {
      completeCalled = true
    },
  })
  const completeCalledBefore = completeCalled
  sourceComposite.removeObservable(observable)

  const actual = {
    completeCalledBefore,
    completeCalled,
  }
  const expected = {
    completeCalledBefore: false,
    completeCalled: true,
  }
  assert({ actual, expected })
}
