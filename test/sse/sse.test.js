import { createRequire } from "module"
import { startServer, createSSERoom } from "@jsenv/server"
import { assert } from "@jsenv/assert"

const require = createRequire(import.meta.url)

const EventSource = require("eventsource")

const openEventSource = async (url) => {
  const eventSource = new EventSource(url, {
    https: { rejectUnauthorized: false },
  })

  const messageEvents = []

  eventSource.addEventListener("message", (messageEvent) => {
    messageEvents.push(messageEvent)
  })

  eventSource.getAllMessageEvents = () => messageEvents

  await new Promise((resolve, reject) => {
    eventSource.onopen = () => {
      eventSource.onerror = () => {}
      eventSource.onopen = () => {}
      resolve()
    }

    eventSource.onerror = (errorEvent) => {
      eventSource.onerror = () => {}
      if (eventSource.readyState === EventSource.CLOSED) {
        reject(errorEvent)
      }
    }
  })

  return eventSource
}

const closeEventSource = (eventSource) => {
  return new Promise((resolve) => {
    // eventSource.onerror = (errorEvent) => {
    //   eventSource.onerror = () => {}
    //   if (eventSource.readyState === EventSource.CLOSED) {
    //     resolve()
    //   } else {
    //     reject(errorEvent)
    //   }
    // }
    eventSource.close()
    resolve()
  })
}

const timeEllapsedPromise = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// a client is notified from an event
{
  const room = createSSERoom()
  room.start()
  const server = await startServer({
    logLevel: "warn",
    keepProcessAlive: false,
    requestToResponse: (request) => {
      return room.connect(
        request.headers["last-event-id"] ||
          new URL(request.ressource, request.origin).searchParams.get("last-event-id"),
      )
    },
  })
  const eventSource = await openEventSource(server.origin)
  room.sendEvent({
    data: 42,
  })
  await timeEllapsedPromise(200)
  const [firstMessageEvent] = eventSource.getAllMessageEvents()
  const actual = {
    type: firstMessageEvent.type,
    data: firstMessageEvent.data,
    lastEventId: firstMessageEvent.lastEventId,
    origin: firstMessageEvent.origin,
  }
  const expected = {
    type: "message",
    data: "42",
    lastEventId: "1",
    origin: server.origin,
  }
  assert({ actual, expected })
  await closeEventSource(eventSource)
  room.stop()
}

// a client is notified of events occuring while he is disconnected
{
  const room = createSSERoom()
  room.start()
  const server = await startServer({
    logLevel: "warn",
    keepProcessAlive: false,
    requestToResponse: (request) => {
      return room.connect(
        request.headers["last-event-id"] ||
          new URL(request.ressource, request.origin).searchParams.get("last-event-id"),
      )
    },
  })
  let eventSource = await openEventSource(server.origin)
  room.sendEvent({
    type: "message",
    data: 42,
  })
  await timeEllapsedPromise(200)
  const [firstMessageEvent] = eventSource.getAllMessageEvents()
  await closeEventSource(eventSource)
  room.sendEvent({
    type: "message",
    data: true,
  })
  await timeEllapsedPromise(200)

  eventSource = await openEventSource(
    `${server.origin}?last-event-id=${firstMessageEvent.lastEventId}`,
  )
  await timeEllapsedPromise(200)
  const [secondMessageEvent] = eventSource.getAllMessageEvents()

  const actual = {
    type: secondMessageEvent.type,
    data: secondMessageEvent.data,
    lastEventId: secondMessageEvent.lastEventId,
    origin: secondMessageEvent.origin,
  }
  const expected = {
    type: "message",
    data: "true",
    lastEventId: "2",
    origin: server.origin,
  }
  assert({ actual, expected })
  await closeEventSource(eventSource)
  await timeEllapsedPromise(200)
  {
    const actual = room.clientCountGetter()
    const expected = 0
    assert({ actual, expected })
  }
  room.stop()
}

// client receive events only from the room he is connected to

// can have many clients

// there is a limit to number of clients

// test whats happens with a room that is not started or is stopped
