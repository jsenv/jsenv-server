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

  eventSource.addEventListener("message", ({ type, data, lastEventId, origin }) => {
    messageEvents.push({ type, data, lastEventId, origin })
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
      if (eventSource.readyState === EventSource.CONNECTING) {
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
    requestToResponse: () => {
      return room.connect()
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

  {
    const actual = room.clientCountGetter()
    const expected = 1
    assert({ actual, expected })
  }

  await closeEventSource(eventSource)
  await timeEllapsedPromise(200)
  // ensure event source is properly closed
  // and room takes that into accout
  {
    const actual = room.clientCountGetter()
    const expected = 0
    assert({ actual, expected })
  }
  room.stop()
}

// a server can have many rooms and client can connect the one he wants
{
  const roomA = createSSERoom()
  roomA.start()
  const roomB = createSSERoom()
  roomB.start()
  const server = await startServer({
    logLevel: "warn",
    keepProcessAlive: false,
    requestToResponse: (request) => {
      if (request.ressource === "/roomA") {
        return roomA.connect(request.headers["last-event-id"])
      }
      if (request.ressource === "/roomB") {
        return roomB.connect(request.headers["last-event-id"])
      }
      return null
    },
  })
  const roomAEventSource = await openEventSource(`${server.origin}/roomA`)
  const roomBEventSource = await openEventSource(`${server.origin}/roomB`)
  roomA.sendEvent({
    type: "message",
    data: "a",
  })
  roomB.sendEvent({
    type: "message",
    data: "b",
  })
  await timeEllapsedPromise(200)

  {
    const actual = roomAEventSource.getAllMessageEvents()
    const expected = [
      {
        type: "message",
        data: "a",
        lastEventId: "1",
        origin: server.origin,
      },
    ]
    assert({ actual, expected })
  }
  {
    const actual = roomBEventSource.getAllMessageEvents()
    const expected = [
      {
        type: "message",
        data: "b",
        lastEventId: "1",
        origin: server.origin,
      },
    ]
    assert({ actual, expected })
  }

  await closeEventSource(roomAEventSource)
  await closeEventSource(roomBEventSource)
  roomA.stop()
  roomB.stop()
}

// a room can have many clients
{
  const room = createSSERoom()
  room.start()
  const server = await startServer({
    logLevel: "warn",
    keepProcessAlive: false,
    requestToResponse: () => {
      return room.connect()
    },
  })
  const clientA = await openEventSource(server.origin)
  const clientB = await openEventSource(server.origin)
  room.sendEvent({
    type: "message",
    data: 42,
  })
  await timeEllapsedPromise(200)
  {
    const actual = room.clientCountGetter()
    const expected = 2
    assert({ actual, expected })
  }
  const clientAEvents = clientA.getAllMessageEvents()
  const clientBEvents = clientB.getAllMessageEvents()
  {
    const actual = clientAEvents
    const expected = [
      {
        type: "message",
        data: "42",
        lastEventId: "1",
        origin: server.origin,
      },
    ]
    assert({ actual, expected })
  }
  {
    const actual = clientBEvents
    const expected = [
      {
        type: "message",
        data: "42",
        lastEventId: "1",
        origin: server.origin,
      },
    ]
    assert({ actual, expected })
  }

  await closeEventSource(clientA)
  await closeEventSource(clientB)
  room.stop()
}

// there can be a limit to number of clients (100 by default)
{
  const room = createSSERoom({
    maxConnectionAllowed: 1,
  })
  room.start()
  const server = await startServer({
    logLevel: "warn",
    keepProcessAlive: false,
    requestToResponse: () => {
      return room.connect()
    },
  })
  const clientA = await openEventSource(server.origin)
  try {
    await openEventSource(server.origin)
    throw new Error("expected to throw")
  } catch (errorEvent) {
    const actual = {
      type: errorEvent.type,
      status: errorEvent.status,
      message: errorEvent.message,
    }
    const expected = {
      type: "error",
      status: 503,
      message: "Service Unavailable",
    }
    assert({ actual, expected })
  } finally {
    await closeEventSource(clientA)
    room.stop()
  }
}

// test whats happens with a room that is not started or is stopped
{
  const room = createSSERoom()
  const server = await startServer({
    logLevel: "warn",
    keepProcessAlive: false,
    requestToResponse: () => {
      return room.connect()
    },
  })
  try {
    await openEventSource(server.origin)
    throw new Error("expected to throw")
  } catch (errorEvent) {
    const actual = {
      type: errorEvent.type,
      status: errorEvent.status,
      message: errorEvent.message,
    }
    const expected = {
      type: "error",
      status: 204,
      message: "No Content",
    }
    assert({ actual, expected })
  }
}
