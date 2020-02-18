// import { resolveUrl } from "@jsenv/util"
import { createCancellationSource, createCancelError, createOperation } from "@jsenv/cancellation"
import { assert } from "@jsenv/assert"
import { createObservable } from "../../../src/internal/observable.js"
import { startServer, fetchUrl } from "../../../index.js"

let serverResponsePromise
const server = await startServer({
  logLevel: "warn",
  protocol: "https",
  keepProcessAlive: false,
  ip: "",
  port: 8998,
  requestToResponse: async ({ cancellationToken }) => {
    return await createOperation({
      cancellationToken,
      start: () => serverResponsePromise,
    })
  },
})
// cancel request before response is found
{
  const cancellationSource = createCancellationSource()
  serverResponsePromise = new Promise(() => {})
  const clientResponsePromise = fetchUrl(server.origin, {
    cancellationToken: cancellationSource.token,
  })
  cancellationSource.cancel("whatever")
  try {
    await clientResponsePromise
    throw new Error("should throw")
  } catch (actual) {
    const expected = createCancelError("whatever")
    assert({ actual, expected })
  }
}
// cancel request while server is responding
{
  const cancellationSource = createCancellationSource()
  serverResponsePromise = new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        status: 200,
      })
    }, 1000)
  })
  const clientResponsePromise = fetchUrl(server.origin, {
    cancellationToken: cancellationSource.token,
  })
  try {
    setTimeout(() => {
      cancellationSource.cancel("whatever")
    }, 200)
    await clientResponsePromise
    throw new Error("should throw")
  } catch (actual) {
    const expected = createCancelError("whatever")
    assert({ actual, expected })
  }
}
// cancel request while body is written
{
  const cancellationSource = createCancellationSource()
  serverResponsePromise = Promise.resolve({
    status: 200,
    body: createObservable({
      subscribe: ({ next }) => {
        next("Hello")
        // never call complete, response is pending
      },
    }),
  })
  const clientResponsePromise = fetchUrl(server.origin, {
    cancellationToken: cancellationSource.token,
  })
  const response = await clientResponsePromise
  try {
    setTimeout(() => {
      cancellationSource.cancel("whatever")
    })
    await response.text()
    throw new Error("should throw")
  } catch (error) {
    const actual = {
      name: error.name,
      type: error.type,
      message: error.message,
    }
    const expected = {
      name: "AbortError",
      type: "aborted",
      message: "The user aborted a request.",
    }
    assert({ actual, expected })
  }
}
// cancel after body is written
{
  const cancellationSource = createCancellationSource()
  serverResponsePromise = Promise.resolve({
    status: 200,
    body: "Hello",
  })
  const clientResponsePromise = fetchUrl(server.origin, {
    cancellationToken: cancellationSource.token,
  })
  const response = await clientResponsePromise
  const actual = await response.text()
  const expected = "Hello"
  assert({ actual, expected })
  cancellationSource.cancel("whatever")
}
