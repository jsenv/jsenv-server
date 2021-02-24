import { createLogger } from "@jsenv/logger"
import { createObservable } from "./internal/observable.js"

// https://www.html5rocks.com/en/tutorials/eventsource/basics/
export const createSSERoom = ({
  logLevel,
  // do not keep process alive because of rooms, something else must keep it alive
  keepProcessAlive = false,
  keepaliveDuration = 30 * 1000,
  retryDuration = 1 * 1000,
  historyLength = 1 * 1000,
  maxClientAllowed = 100, // max 100 clients accepted
  computeEventId = (event, lastEventId) => lastEventId + 1,
  welcomeEvent = false,
  welcomeEventPublic = false,
} = {}) => {
  const logger = createLogger({ logLevel })

  const clients = new Set()
  const eventHistory = createEventHistory(historyLength)
  // what about previousEventId that keeps growing ?
  // we could add some limit
  // one limit could be that an event older than 24h is deleted
  let previousEventId = 0
  let opened = false
  let interval

  const join = (request) => {
    // should we ensure a given request can join a room only once?
    // if so we should avoid to store request to remember it is already
    // in a room otherwise it cannot be garbage collected
    // by the way our current implementation prevent request from being garbage collected
    // (anyway if it's kept alive I'm sure something in Node.js keeps it in memory)

    // should we allow a given request to join 2 different room ?
    // why not but it means client.write
    // should write in n response body instead of 1
    // et aussi de pouvoir leave une room
    // devrait alors unsubsribe une partie de la connection et pas tout

    const lastKnownId =
      request.headers["last-event-id"] ||
      new URL(request.ressource, request.origin).searchParams.get("last-event-id")

    if (clients.size >= maxClientAllowed) {
      return {
        status: 503,
      }
    }

    if (!opened) {
      return {
        status: 204,
      }
    }

    const firstEvent = {
      retry: retryDuration,
      type: "comment",
      data: new Date().toLocaleTimeString(),
    }
    if (welcomeEvent) {
      firstEvent.type = "welcome"
      firstEvent.id = computeEventId(firstEvent, previousEventId)
      previousEventId = firstEvent.id
      eventHistory.add(firstEvent)
    }

    const events = [
      // send events which occured between lastKnownId & now
      ...(lastKnownId === undefined ? [] : eventsSince(lastKnownId)),
      firstEvent,
    ]

    const client = {
      request,
      unsubscribe: () => {
        if (clients.has(client)) {
          clients.delete(client)
          logger.debug(
            `client connection closed by us, number of client connected to event source: ${clients.size}`,
          )
        }
      },
      write: () => {},
    }
    clients.add(client)

    const body = createObservable({
      subscribe: ({ next }) => {
        client.write = next

        events.forEach((event) => {
          logger.debug(`send ${event.type} event to this new client`)
          next(stringifySourceEvent(event))
        })

        return {
          unsubscribe: client.unsubscribe,
        }
      },
    })

    logger.debug(
      `client joined, number of client connected to event source: ${clients.size}, max allowed: ${maxClientAllowed}`,
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

  const sendEvent = (event) => {
    if (event.type !== "comment") {
      logger.debug(
        `send ${event.type} event, number of client listening event source: ${clients.size}`,
      )
      if (typeof event.id === "undefined") {
        event.id = computeEventId(event, previousEventId)
      }
      previousEventId = event.id
      eventHistory.add(event)
    }

    write(stringifySourceEvent(event))
  }

  const eventsSince = (id) => {
    const events = eventHistory.since(id)
    if (welcomeEvent && !welcomeEventPublic) {
      return events.filter((event) => event.type !== "welcome")
    }
    return events
  }

  const write = (data) => {
    clients.forEach((client) => {
      client.write(data)
    })
  }

  const keepAlive = () => {
    // maybe that, when an event occurs, we can delay the keep alive event
    logger.debug(`send keep alive event, number of client listening event source: ${clients.size}`)
    sendEvent({
      type: "comment",
      data: new Date().toLocaleTimeString(),
    })
  }

  const open = () => {
    if (opened) return
    opened = true
    interval = setInterval(keepAlive, keepaliveDuration)
    if (!keepProcessAlive) {
      interval.unref()
    }
  }

  const close = () => {
    if (!opened) return
    logger.debug(`closing, number of client to close: ${clients.size}`)
    clients.forEach((client) => client.unsubscribe())
    // each client.umsubscribe is doing clients.delete(connection)
    // meaning at this stage clients.size is 0
    clearInterval(interval)
    eventHistory.reset()
    opened = false
  }

  open()

  return {
    // main api:
    // - ability to sendEvent to users in the room
    // - ability to join the room
    sendEvent,
    join,

    // should rarely be necessary, get information about the room
    eventsSince,
    getRoomClientCount: () => clients.size,

    // should rarely be used
    close,
    open,
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
