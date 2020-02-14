/* eslint-disable import/max-dependencies */

import { createRequire } from "module"
import { STATUS_CODES } from "http"
import {
  createCancellationToken,
  createOperation,
  createStoppableOperation,
  composeCancellationToken,
  createCancellationSource,
  isCancelError,
} from "@jsenv/cancellation"
import { SIGINTSignal, unadvisedCrashSignal, teardownSignal } from "@jsenv/node-signals"
import { catchCancellation, memoize } from "@jsenv/util"
import { createLogger } from "@jsenv/logger"
import { createTracker } from "./internal/createTracker.js"
import { urlToOrigin } from "./internal/urlToOrigin.js"
import { createServer } from "./internal/createServer.js"
import { trackServerPendingSessions } from "./internal/trackServerPendingSessions.js"
import { trackServerPendingStreams } from "./internal/trackServerPendingStreams.js"
import { populateHttp2Stream } from "./internal/populateHttp2Stream.js"
import { trackServerPendingConnections } from "./internal/trackServerPendingConnections.js"
import { trackServerPendingRequests } from "./internal/trackServerPendingRequests.js"
import { nodeRequestToRequest } from "./internal/nodeRequestToRequest.js"
import { composeResponseHeaders } from "./internal/composeResponseHeaders.js"
import { populateNodeResponse } from "./internal/populateNodeResponse.js"
import { colorizeResponseStatus } from "./internal/colorizeResponseStatus.js"
import { originAsString } from "./internal/originAsString.js"
import { listen, stopListening } from "./internal/listen.js"
import { composeResponse } from "./composeResponse.js"
import {
  STOP_REASON_INTERNAL_ERROR,
  STOP_REASON_PROCESS_SIGHUP,
  STOP_REASON_PROCESS_SIGTERM,
  STOP_REASON_PROCESS_SIGINT,
  STOP_REASON_PROCESS_BEFORE_EXIT,
  STOP_REASON_PROCESS_EXIT,
  STOP_REASON_NOT_SPECIFIED,
} from "./stopReasons.js"
import { jsenvAccessControlAllowedHeaders } from "./jsenvAccessControlAllowedHeaders.js"
import { jsenvAccessControlAllowedMethods } from "./jsenvAccessControlAllowedMethods.js"
import { jsenvPrivateKey, jsenvCertificate } from "./jsenvSignature.js"
import { streamDataToRequest } from "./internal/streamDataToRequest.js"

const require = createRequire(import.meta.url)
const killPort = require("kill-port")

export const startServer = async ({
  cancellationToken = createCancellationToken(),
  logLevel,
  serverName = "server",
  http2 = false,

  protocol = "http",
  ip = "127.0.0.1",
  port = 0, // assign a random available port
  forcePort = false,
  privateKey = jsenvPrivateKey,
  certificate = jsenvCertificate,

  stopOnSIGINT = true,
  // auto close the server when the process exits
  stopOnExit = true,
  // auto close when requestToResponse throw an error
  stopOnInternalError = true,
  // auto close the server when an uncaughtException happens
  stopOnCrash = false,
  keepProcessAlive = true,
  requestToResponse = () => null,

  accessControlAllowedOrigins = [],
  accessControlAllowedMethods = jsenvAccessControlAllowedMethods,
  accessControlAllowedHeaders = jsenvAccessControlAllowedHeaders,
  accessControlAllowRequestOrigin = false,
  accessControlAllowRequestMethod = false,
  accessControlAllowRequestHeaders = false,
  accessControlAllowCredentials = false,
  // by default OPTIONS request can be cache for a long time, it's not going to change soon ?
  // we could put a lot here, see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
  accessControlMaxAge = 600,

  sendInternalErrorStack = false,
  internalErrorToResponseProperties = (error) => {
    const body = error
      ? JSON.stringify({
          code: error.code || "UNKNOWN_ERROR",
          ...(sendInternalErrorStack ? { stack: error.stack } : {}),
        })
      : JSON.stringify({ code: "VALUE_THROWED", value: error })

    return {
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      body,
    }
  },
  startedCallback = () => {},
  stoppedCallback = () => {},
  errorIsCancellation = () => false,
} = {}) => {
  return catchCancellation(async () => {
    if (port === 0 && forcePort) {
      throw new Error(`no need to pass forcePort when port is 0`)
    }
    if (protocol !== "http" && protocol !== "https") {
      throw new Error(`protocol must be http or https, got ${protocol}`)
    }
    // https://github.com/nodejs/node/issues/14900
    if (ip === "0.0.0.0" && process.platform === "win32") {
      throw new Error(`listening ${ip} not available on window`)
    }
    if (protocol === "https") {
      if (!privateKey) {
        throw new Error(`missing privateKey for https server`)
      }
      if (!certificate) {
        throw new Error(`missing certificate for https server`)
      }
      if (privateKey !== jsenvPrivateKey && certificate === jsenvCertificate) {
        throw new Error(`you passed a privateKey without certificate`)
      }
      if (certificate !== jsenvCertificate && privateKey === jsenvPrivateKey) {
        throw new Error(`you passed a certificate without privateKey`)
      }
    }

    const internalCancellationSource = createCancellationSource()
    const externalCancellationToken = cancellationToken
    const internalCancellationToken = internalCancellationSource.token
    const serverCancellationToken = composeCancellationToken(
      externalCancellationToken,
      internalCancellationToken,
    )

    const logger = createLogger({ logLevel })

    const onError = (error) => {
      if (errorIsCancellation(error)) {
        return
      }
      throw error
    }
    errorIsCancellation = composePredicate(errorIsCancellation, isCancelError)

    const { registerCleanupCallback, cleanup } = createTracker()

    if (stopOnCrash) {
      const unregister = unadvisedCrashSignal.addCallback((reason) => {
        internalCancellationSource.cancel(reason.value)
      })
      registerCleanupCallback(unregister)
    }

    if (stopOnExit) {
      const unregister = teardownSignal.addCallback((tearDownReason) => {
        if (!stopOnSIGINT && tearDownReason === "SIGINT") {
          return
        }

        internalCancellationSource.cancel(
          {
            SIGHUP: STOP_REASON_PROCESS_SIGHUP,
            SIGTERM: STOP_REASON_PROCESS_SIGTERM,
            SIGINT: STOP_REASON_PROCESS_SIGINT,
            beforeExit: STOP_REASON_PROCESS_BEFORE_EXIT,
            exit: STOP_REASON_PROCESS_EXIT,
          }[tearDownReason],
        )
      })
      registerCleanupCallback(unregister)
    } else if (stopOnSIGINT) {
      const unregister = SIGINTSignal.addCallback(() => {
        internalCancellationSource.cancel(STOP_REASON_PROCESS_SIGINT)
      })
      registerCleanupCallback(unregister)
    }

    if (forcePort) {
      await createOperation({
        cancellationToken: serverCancellationToken,
        start: () => killPort(port),
      })
    }

    const nodeServer = await createServer({ http2, protocol, privateKey, certificate })

    // https://nodejs.org/api/net.html#net_server_unref
    if (!keepProcessAlive) {
      nodeServer.unref()
    }

    let status = "starting"

    let stoppedResolve
    const stoppedPromise = new Promise((resolve) => {
      stoppedResolve = resolve
    })
    const stop = memoize(async (reason = STOP_REASON_NOT_SPECIFIED) => {
      status = "stopping"

      errorIsCancellation = composePredicate(errorIsCancellation, (error) => error === reason)
      errorIsCancellation = composePredicate(
        errorIsCancellation,
        (error) => error && error.code === "ECONNRESET",
      )
      logger.info(`${serverName} stopped because ${reason}`)

      await cleanup(reason)
      await stopListening(nodeServer)
      status = "stopped"
      stoppedCallback({ reason })
      stoppedResolve(reason)
    })
    serverCancellationToken.register(stop)
    const startOperation = createStoppableOperation({
      cancellationToken: serverCancellationToken,
      start: () =>
        listen({ cancellationToken: serverCancellationToken, server: nodeServer, port, ip }),
      stop: (_, reason) => stop(reason),
    })

    port = await startOperation
    status = "opened"
    const serverOrigin = originAsString({ protocol, ip, port })

    if (http2) {
      const sessionsTracker = trackServerPendingSessions(nodeServer, {
        onSessionError: onError,
      })
      registerCleanupCallback(sessionsTracker.stop)

      const pendingStreamsTracker = trackServerPendingStreams(nodeServer)
      // ensure pending requests got a response from the server
      registerCleanupCallback((reason) => {
        pendingStreamsTracker.stop({
          status: reason === STOP_REASON_INTERNAL_ERROR ? 500 : 503,
          reason,
        })
      })

      const streamCallback = async (stream, headers, flags) => {
        const request = streamDataToRequest(
          { stream, headers, flags },
          { serverCancellationToken, serverOrigin },
        )
        stream.on("error", (error) => {
          logger.error(`error on stream.
--- stream path ---
${request.ressource}
--- error stack ---
${error}`)
        })
        const response = await getResponse(request)
        populateHttp2Stream(stream, response)
      }

      nodeServer.on("stream", streamCallback)
      // ensure we don't try to handle new streams while server is stopping
      registerCleanupCallback(() => {
        nodeServer.removeListener("request", streamCallback)
      })
    } else {
      const connectionsTracker = trackServerPendingConnections(nodeServer, {
        onConnectionError: onError,
      })
      // opened connection must be shutdown before the close event is emitted
      registerCleanupCallback(connectionsTracker.stop)

      const pendingRequestsTracker = trackServerPendingRequests(nodeServer)
      // ensure pending requests got a response from the server
      registerCleanupCallback((reason) => {
        pendingRequestsTracker.stop({
          status: reason === STOP_REASON_INTERNAL_ERROR ? 500 : 503,
          reason,
        })
      })

      const requestCallback = async (nodeRequest, nodeResponse) => {
        const request = nodeRequestToRequest(nodeRequest, { serverCancellationToken, serverOrigin })
        nodeRequest.on("error", (error) => {
          logger.error(`error on request.
--- request ressource ---
${request.ressource}
--- error stack ---
${error}`)
        })
        const response = await getResponse(request)
        populateNodeResponse(nodeResponse, response, {
          ignoreBody: request.method === "HEAD",
        })
      }

      nodeServer.on("request", requestCallback)
      // ensure we don't try to handle new requests while server is stopping
      registerCleanupCallback(() => {
        nodeServer.removeListener("request", requestCallback)
      })
    }

    logger.info(`${serverName} started at ${serverOrigin}`)
    startedCallback({ origin: serverOrigin })

    const corsEnabled = accessControlAllowRequestOrigin || accessControlAllowedOrigins.length
    // here we check access control options to throw or warn if we find strange values

    const getResponse = async (request) => {
      const { response, error } = await generateResponseDescription(request)

      if (
        request.method !== "HEAD" &&
        response.headers["content-length"] > 0 &&
        response.body === ""
      ) {
        logger.error(
          createContentLengthMismatchError(
            `content-length header is ${response.headers["content-length"]} but body is empty`,
          ),
        )
      }

      logger.info(`${request.method} ${request.origin}${request.ressource}`)
      if (error) {
        logger.error(`internal error while handling request.
--- error stack ---
${error.stack}
--- request ---
${request.method} ${request.origin}${request.ressource}`)
      }
      logger.info(`${colorizeResponseStatus(response.status)} ${response.statusText}`)

      if (
        stopOnInternalError &&
        // stopOnInternalError stops server only if requestToResponse generated
        // a non controlled error (internal error).
        // if requestToResponse gracefully produced a 500 response (it did not throw)
        // then we can assume we are still in control of what we are doing
        error
      ) {
        // il faudrais pouvoir stop que les autres response ?
        setTimeout(() => stop(STOP_REASON_INTERNAL_ERROR))
      }

      return response
    }

    const generateResponseDescription = async (request) => {
      const responsePropertiesToResponse = ({
        status = 501,
        statusText = statusToStatusText(status),
        headers = {},
        body = "",
        bodyEncoding,
      }) => {
        if (corsEnabled) {
          const accessControlHeaders = generateAccessControlHeaders({
            request,
            accessControlAllowedOrigins,
            accessControlAllowRequestOrigin,
            accessControlAllowedMethods,
            accessControlAllowRequestMethod,
            accessControlAllowedHeaders,
            accessControlAllowRequestHeaders,
            accessControlAllowCredentials,
            accessControlMaxAge,
          })

          return {
            status,
            statusText,
            headers: composeResponseHeaders(headers, accessControlHeaders),
            body,
            bodyEncoding,
          }
        }

        return {
          status,
          statusText,
          headers,
          body,
          bodyEncoding,
        }
      }

      try {
        if (corsEnabled && request.method === "OPTIONS") {
          return {
            response: responsePropertiesToResponse({
              status: 200,
              headers: {
                "content-length": 0,
              },
            }),
          }
        }

        const responseProperties = await requestToResponse(request)
        return {
          response: responsePropertiesToResponse(responseProperties || {}),
        }
      } catch (error) {
        return {
          response: composeResponse(
            responsePropertiesToResponse({
              status: 500,
              headers: {
                // ensure error are not cached
                "cache-control": "no-store",
                "content-type": "text/plain",
              },
            }),
            internalErrorToResponseProperties(error),
          ),
          error,
        }
      }
    }

    return {
      getStatus: () => status,
      origin: serverOrigin,
      nodeServer,
      stop,
      stoppedPromise,
    }
  })
}

const statusToStatusText = (status) => STATUS_CODES[status] || "not specified"

const createContentLengthMismatchError = (message) => {
  const error = new Error(message)
  error.code = "CONTENT_LENGTH_MISMATCH"
  error.name = error.code
  return error
}

// https://www.w3.org/TR/cors/
// https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
const generateAccessControlHeaders = ({
  request: { headers },
  accessControlAllowedOrigins,
  accessControlAllowRequestOrigin,
  accessControlAllowedMethods,
  accessControlAllowRequestMethod,
  accessControlAllowedHeaders,
  accessControlAllowRequestHeaders,
  accessControlAllowCredentials,
  // by default OPTIONS request can be cache for a long time, it's not going to change soon ?
  // we could put a lot here, see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
  accessControlMaxAge = 600,
} = {}) => {
  const vary = []

  const allowedOriginArray = [...accessControlAllowedOrigins]
  if (accessControlAllowRequestOrigin) {
    if ("origin" in headers && headers.origin !== "null") {
      allowedOriginArray.push(headers.origin)
      vary.push("origin")
    } else if ("referer" in headers) {
      allowedOriginArray.push(urlToOrigin(headers.referer))
      vary.push("referer")
    } else {
      allowedOriginArray.push("*")
    }
  }

  const allowedMethodArray = [...accessControlAllowedMethods]
  if (accessControlAllowRequestMethod && "access-control-request-method" in headers) {
    const requestMethodName = headers["access-control-request-method"]
    if (!allowedMethodArray.includes(requestMethodName)) {
      allowedMethodArray.push(requestMethodName)
      vary.push("access-control-request-method")
    }
  }

  const allowedHeaderArray = [...accessControlAllowedHeaders]
  if (accessControlAllowRequestHeaders && "access-control-request-headers" in headers) {
    const requestHeaderNameArray = headers["access-control-request-headers"].split(", ")
    requestHeaderNameArray.forEach((headerName) => {
      const headerNameLowerCase = headerName.toLowerCase()
      if (!allowedHeaderArray.includes(headerNameLowerCase)) {
        allowedHeaderArray.push(headerNameLowerCase)
        if (!vary.includes("access-control-request-headers")) {
          vary.push("access-control-request-headers")
        }
      }
    })
  }

  return {
    "access-control-allow-origin": allowedOriginArray.join(", "),
    "access-control-allow-methods": allowedMethodArray.join(", "),
    "access-control-allow-headers": allowedHeaderArray.join(", "),
    ...(accessControlAllowCredentials ? { "access-control-allow-credentials": true } : {}),
    "access-control-max-age": accessControlMaxAge,
    ...(vary.length ? { vary: vary.join(", ") } : {}),
  }
}

const composePredicate = (previousPredicate, predicate) => {
  return (value) => {
    return previousPredicate(value) || predicate(value)
  }
}
