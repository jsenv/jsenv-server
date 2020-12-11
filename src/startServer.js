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
  executeAsyncFunction,
} from "@jsenv/cancellation"
import { SIGINTSignal, unadvisedCrashSignal, teardownSignal } from "@jsenv/node-signals"
import { memoize, urlToOrigin } from "@jsenv/util"
import { createLogger } from "@jsenv/logger"
import { createTracker } from "./internal/createTracker.js"
import { createServer } from "./internal/createServer.js"
import { trackServerPendingConnections } from "./internal/trackServerPendingConnections.js"
import { trackServerPendingRequests } from "./internal/trackServerPendingRequests.js"
import { nodeRequestToRequest } from "./internal/nodeRequestToRequest.js"
import { composeResponseHeaders } from "./internal/composeResponseHeaders.js"
import { populateNodeResponse } from "./internal/populateNodeResponse.js"
import { colorizeResponseStatus } from "./internal/colorizeResponseStatus.js"
import { getServerOrigins } from "./internal/getServerOrigins.js"
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
import { findFreePort } from "./findFreePort.js"
import { trackServerRequest } from "./internal/trackServerRequest.js"
import { timeFunction, timingToServerTimingResponseHeaders } from "./serverTiming.js"
import { jsenvServerInternalErrorToResponse } from "./jsenvServerInternalErrorToResponse.js"
import { checkContentNegotiation } from "./internal/checkContentNegotiation.js"

const require = createRequire(import.meta.url)
const killPort = require("kill-port")

export const startServer = async ({
  cancellationToken = createCancellationToken(),
  logLevel,
  serverName = "server",

  protocol = "http",
  http2 = false,
  http1Allowed = true,
  redirectHttpToHttps,
  ip = "0.0.0.0", // will it work on windows ? https://github.com/nodejs/node/issues/14900
  port = 0, // assign a random available port
  portHint,
  forcePort = false,
  privateKey = jsenvPrivateKey,
  certificate = jsenvCertificate,

  stopOnSIGINT = true,
  // auto close the server when the process exits
  stopOnExit = true,
  // auto close when requestToResponse throw an error
  stopOnInternalError = false,
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

  // https://www.w3.org/TR/server-timing/
  sendServerTiming = false,
  sendServerInternalErrorDetails = false,
  serverInternalErrorToResponse = jsenvServerInternalErrorToResponse,

  requestWaitingMs = 20000,
  requestWaitingCallback = (request, { logger }) => {
    logger.warn(
      `still no response found for request after ${requestWaitingMs} ms
--- request url ---
${request.origin}${request.ressource}
--- request headers ---
${JSON.stringify(request.headers, null, "  ")}
`,
    )
  },
  contentNegotiationWarnings = true,

  startedCallback = () => {},
  stoppedCallback = () => {},
  errorIsCancellation = () => false,
  nagle = true,
} = {}) => {
  return executeAsyncFunction(async () => {
    if (port === 0 && forcePort) {
      throw new Error(`no need to pass forcePort when port is 0`)
    }
    if (protocol !== "http" && protocol !== "https") {
      throw new Error(`protocol must be http or https, got ${protocol}`)
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
    if (http2 && protocol !== "https") {
      throw new Error(`http2 needs "https" but protocol is "${protocol}"`)
    }

    const logger = createLogger({ logLevel })
    if (redirectHttpToHttps === undefined && protocol === "https" && !http2) {
      redirectHttpToHttps = true
    }
    if (redirectHttpToHttps && protocol === "http") {
      logger.warn(`redirectHttpToHttps ignored because protocol is http`)
      redirectHttpToHttps = false
    }
    if (redirectHttpToHttps && http2) {
      logger.warn(
        `redirectHttpToHttps ignored because it does not work with http2. see https://github.com/nodejs/node/issues/23331`,
      )
      redirectHttpToHttps = false
    }

    const internalCancellationSource = createCancellationSource()
    const externalCancellationToken = cancellationToken
    const internalCancellationToken = internalCancellationSource.token
    const serverCancellationToken = composeCancellationToken(
      externalCancellationToken,
      internalCancellationToken,
    )

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

    const nodeServer = await createServer({
      http2,
      http1Allowed,
      protocol,
      privateKey,
      certificate,
    })

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
      start: async () => {
        if (portHint) {
          port = await findFreePort(portHint, { cancellationToken: serverCancellationToken, ip })
        }
        return listen({
          cancellationToken: serverCancellationToken,
          server: nodeServer,
          port,
          ip,
        })
      },
      stop: (_, reason) => stop(reason),
    })

    port = await startOperation
    status = "opened"
    const serverOrigins = getServerOrigins({ protocol, ip, port })
    const serverOrigin = serverOrigins.main

    const connectionsTracker = trackServerPendingConnections(nodeServer, {
      http2,
      onConnectionError: (error, connection) => {
        if (!connection.destroyed) {
          onError(error)
        }
      },
    })
    // opened connection must be shutdown before the close event is emitted
    registerCleanupCallback(connectionsTracker.stop)

    const pendingRequestsTracker = trackServerPendingRequests(nodeServer, { http2 })
    // ensure pending requests got a response from the server
    registerCleanupCallback((reason) => {
      pendingRequestsTracker.stop({
        status: reason === STOP_REASON_INTERNAL_ERROR ? 500 : 503,
        reason,
      })
    })

    const requestCallback = async (nodeRequest, nodeResponse) => {
      if (!nagle) {
        nodeRequest.connection.setNoDelay(true)
      }
      if (redirectHttpToHttps && !nodeRequest.connection.encrypted) {
        nodeResponse.writeHead(301, {
          location: `${serverOrigin}${nodeRequest.ressource}`,
        })
        return
      }

      const request = nodeRequestToRequest(nodeRequest, { serverCancellationToken, serverOrigin })
      nodeRequest.on("error", (error) => {
        logger.error(`error on request.
--- request ressource ---
${request.ressource}
--- error stack ---
${error.stack}`)
      })

      const [
        startRespondingTiming,
        { response, error },
      ] = await timeFunction("time to start responding", () => generateResponseDescription(request))
      if (sendServerTiming) {
        const serverTiming = {
          ...response.timing,
          ...startRespondingTiming,
        }
        response.headers = composeResponseHeaders(
          timingToServerTimingResponseHeaders(serverTiming),
          response.headers,
        )

        if (contentNegotiationWarnings) {
          checkContentNegotiation(request, response, { warn: logger.warn })
        }
      }

      logger.info(`${request.method} ${request.origin}${request.ressource}`)

      if (error && isCancelError(error) && internalCancellationToken.cancellationRequested) {
        logger.info("ignored because server closing")
        nodeResponse.destroy()
        return
      }

      if (error && isCancelError(error) && request.cancellationToken.cancellationRequested) {
        logger.info("ignored because request canceled")
        nodeResponse.destroy()
        return
      }

      if (request.aborted) {
        logger.info(`request aborted by client`)
        nodeResponse.destroy()
        return
      }

      if (
        request.method !== "HEAD" &&
        response.headers["content-length"] > 0 &&
        response.body === ""
      ) {
        logger.warn(
          `content-length header is ${response.headers["content-length"]} but body is empty`,
        )
      }

      if (error) {
        logger.error(`internal error while handling request.
--- error stack ---
${error.stack}
--- request ---
${request.method} ${request.origin}${request.ressource}`)
      }
      logger.info(`${colorizeResponseStatus(response.status)} ${response.statusText}`)

      populateNodeResponse(nodeResponse, response, {
        cancellationToken: request.cancellationToken,
        ignoreBody: request.method === "HEAD",
        // https://github.com/nodejs/node/blob/79296dc2d02c0b9872bbfcbb89148ea036a546d0/lib/internal/http2/compat.js#L97
        ignoreStatusText: Boolean(nodeRequest.stream),
        // https://github.com/nodejs/node/blob/79296dc2d02c0b9872bbfcbb89148ea036a546d0/lib/internal/http2/compat.js#L112
        ignoreConnectionHeader: Boolean(nodeRequest.stream),
      })

      if (
        stopOnInternalError &&
        // stopOnInternalError stops server only if requestToResponse generated
        // a non controlled error (internal error).
        // if requestToResponse gracefully produced a 500 response (it did not throw)
        // then we can assume we are still in control of what we are doing
        error
      ) {
        // il faudrais pouvoir stop que les autres response ?
        stop(STOP_REASON_INTERNAL_ERROR)
      }
    }

    const removeRequestListener = trackServerRequest(nodeServer, requestCallback, { http2 })
    // ensure we don't try to handle new requests while server is stopping
    registerCleanupCallback(removeRequestListener)

    logger.info(`${serverName} started at ${serverOrigin} (${serverOrigins.external})`)
    startedCallback({ origin: serverOrigin })

    const corsEnabled = accessControlAllowRequestOrigin || accessControlAllowedOrigins.length
    // here we check access control options to throw or warn if we find strange values

    const generateResponseDescription = async (request) => {
      const responsePropertiesToResponse = ({
        status = 501,
        statusText = statusToStatusText(status),
        headers = {},
        body = "",
        bodyEncoding,
        timing,
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
            sendServerTiming,
          })

          return {
            status,
            statusText,
            headers: composeResponseHeaders(headers, accessControlHeaders),
            body,
            bodyEncoding,
            timing,
          }
        }

        return {
          status,
          statusText,
          headers,
          body,
          bodyEncoding,
          timing,
        }
      }

      let timeout
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

        timeout = setTimeout(
          () => requestWaitingCallback(request, { logger, requestWaitingMs }),
          requestWaitingMs,
        )

        const responseProperties = await requestToResponse(request)
        clearTimeout(timeout)
        return {
          response: responsePropertiesToResponse(responseProperties || {}),
        }
      } catch (error) {
        clearTimeout(timeout)
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
            await serverInternalErrorToResponse(error, {
              request,
              sendServerInternalErrorDetails,
            }),
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
  sendServerTiming,
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
    ...(sendServerTiming ? { "timing-allow-origin": allowedOriginArray.join(", ") } : {}),
    ...(vary.length ? { vary: vary.join(", ") } : {}),
  }
}

const composePredicate = (previousPredicate, predicate) => {
  return (value) => {
    return previousPredicate(value) || predicate(value)
  }
}
