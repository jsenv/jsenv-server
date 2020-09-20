import { createLogger } from "@jsenv/logger"
import { createObservable } from "./internal/observable.js"

// https://www.html5rocks.com/en/tutorials/eventsource/basics/
export const createSSERoom = ({
  logLevel,
  keepaliveDuration = 30 * 1000,
  retryDuration = 1 * 1000,
  historyLength = 1 * 1000,
  maxConnectionAllowed = 100, // max 100 users accepted
  computeEventId = (event, lastEventId) => lastEventId + 1,
  welcomeEvent = false,
  welcomeEventPublic = false,
} = {}) => {
  const logger = createLogger({ logLevel })

  const connections = new Set()
  const eventHistory = createEventHistory(historyLength)
  // what about previousEventId that keeps growing ?
  // we could add some limit
  // one limit could be that an event older than 24h is deleted
  let previousEventId = 0
  let state = "closed"
  let interval

  const eventsSince = (id) => {
    const events = eventHistory.since(id)
    if (welcomeEvent && !welcomeEventPublic) {
      return events.filter((event) => event.type !== "welcome")
    }
    return events
  }

  const connect = (lastKnownId) => {
    if (connections.size > maxConnectionAllowed) {
      return {
        status: 503,
      }
    }
    if (state === "closed") {
      return {
        status: 204,
      }
    }

    const firstEvent = {
      retry: retryDuration,
      type: welcomeEvent ? "welcome" : "comment",
      data: new Date().toLocaleTimeString(),
    }

    if (welcomeEvent) {
      firstEvent.id = computeEventId(firstEvent, previousEventId)
      previousEventId = firstEvent.id
      eventHistory.add(firstEvent)
    }

    const events = [
      // send events which occured between lastKnownId & now
      ...(lastKnownId === undefined ? [] : eventsSince(lastKnownId)),
      firstEvent,
    ]

    const body = createObservable({
      subscribe: ({ next }) => {
        events.forEach((event) => {
          logger.debug(`send ${event.type} event to this new client`)
          next(stringifySourceEvent(event))
        })

        const connection = {
          write: next,
        }

        const unsubscribe = () => {
          connections.delete(connection)
          logger.debug(
            `connection closed by us, number of client connected to event source: ${connections.size}`,
          )
        }

        connection.unsubscribe = unsubscribe
        connections.add(connection)

        return {
          unsubscribe,
        }
      },
    })

    logger.debug(
      `client joined, number of client connected to event source: ${connections.size}, max allowed: ${maxConnectionAllowed}`,
    )

    return {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "connection": "keep-alive",
      },
      body,
    }
  }

  const write = (data) => {
    connections.forEach((connection) => {
      connection.write(data)
    })
  }

  const sendEvent = (event) => {
    if (event.type !== "comment") {
      logger.debug(
        `send ${event.type} event, number of client listening event source: ${connections.size}`,
      )
      if (typeof event.id === "undefined") {
        event.id = computeEventId(event, previousEventId)
      }
      previousEventId = event.id
      eventHistory.add(event)
    }

    write(stringifySourceEvent(event))
  }

  const keepAlive = () => {
    // maybe that, when an event occurs, we can delay the keep alive event
    logger.debug(
      `send keep alive event, number of client listening event source: ${connections.size}`,
    )
    sendEvent({
      type: "comment",
      data: new Date().toLocaleTimeString(),
    })
  }

  const start = () => {
    state = "started"
    interval = setInterval(keepAlive, keepaliveDuration)
  }

  const stop = () => {
    logger.debug(`stopping, number of client to close: ${connections.size}`)
    connections.forEach((connection) => connection.unsubscribe())
    clearInterval(interval)
    eventHistory.reset()
    state = "stopped"
  }

  return {
    start,
    stop,
    connect,
    eventsSince,
    sendEvent,
  }
}

// https://github.com/dmail-old/project/commit/da7d2c88fc8273850812972885d030a22f9d7448
// https://github.com/dmail-old/project/commit/98b3ae6748d461ac4bd9c48944a551b1128f4459

// https://github.com/dmail-old/http-eventsource/blob/master/lib/event-source.js

// http://html5doctor.com/server-sent-events/
const stringifySourceEvent = ({ data, type = "message", id, retry }) => {
  let string = ""

  if (id !== undefined) {
    string += `id:${id}\n`
  }

  if (retry) {
    string += `retry:${retry}\n`
  }

  if (type !== "message") {
    string += `event:${type}\n`
  }

  string += `data:${data}\n\n`

  return string
}

const createEventHistory = (limit) => {
  const events = []

  const add = (data) => {
    events.push(data)

    if (events.length >= limit) {
      events.shift()
    }
  }

  const since = (id) => {
    const index = events.findIndex((event) => String(event.id) === id)
    return index === -1 ? [] : events.slice(index + 1)
  }

  const reset = () => {
    events.length = 0
  }

  return { add, since, reset }
}
