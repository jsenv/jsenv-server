/* eslint-disable import/max-dependencies */
import { createServer as createNodeServer, STATUS_CODES } from "http"
import { createServer as createNodeSecureServer, Agent as SecureAgent } from "https"
import { createRequire } from "module"
import {
  createCancellationToken,
  createOperation,
  createStoppableOperation,
  composeCancellationToken,
  createCancellationSource,
  isCancelError,
} from "@jsenv/cancellation"
import { SIGINTSignal, unadvisedCrashSignal, teardownSignal } from "@jsenv/node-signals"
import { createLogger } from "@jsenv/logger"
import { memoizeOnce } from "./internal/memoizeOnce.js"
import { urlToOrigin } from "./internal/urlToOrigin.js"
import { trackConnections } from "./internal/trackConnections.js"
import { trackClients } from "./internal/trackClients.js"
import { trackRequestHandlers } from "./internal/trackRequestHandlers.js"
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

const require = createRequire(import.meta.url)
const killPort = require("kill-port")

const STATUS_TEXT_INTERNAL_ERROR = "internal error"

export const startServer = async ({
  cancellationToken = createCancellationToken(),
  logLevel,
  serverName = "server",

  protocol = "http",
  ip = "127.0.0.1",
  port = 0, // assign a random available port
  forcePort = false,
  privateKey = jsenvPrivateKey,
  certificate = jsenvCertificate,

  stopOnSIGINT = true,
  // auto close the server when the process exits
  stopOnExit = true,
  // auto close when server respond with a 500
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
} = {}) => {
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

  const logger = createLogger({ logLevel })

  const internalCancellationSource = createCancellationSource()
  cancellationToken = composeCancellationToken(cancellationToken, internalCancellationSource.token)
  const { registerCleanupCallback, cleanup } = createTracker()

  if (stopOnCrash) {
    const unregister = unadvisedCrashSignal.addCallback((reason) => {
      internalCancellationSource.cancel(reason.value)
    })
    registerCleanupCallback(unregister)
  }

  if (stopOnExit) {
    const unregister = teardownSignal.addCallback((tearDownReason) => {
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
      cancellationToken,
      start: () => killPort(port),
    })
  }

  const { nodeServer, agent } = getNodeServerAndAgent({ protocol, privateKey, certificate })

  // https://nodejs.org/api/net.html#net_server_unref
  if (!keepProcessAlive) {
    nodeServer.unref()
  }

  let status = "starting"
  let onConnectionError = () => {}

  const connectionTracker = trackConnections(nodeServer, { onConnectionError })
  // opened connection must be shutdown before the close event is emitted
  registerCleanupCallback(connectionTracker.stop)

  const clientTracker = trackClients(nodeServer)
  registerCleanupCallback((reason) => {
    let responseStatus
    if (reason === STOP_REASON_INTERNAL_ERROR) {
      responseStatus = 500
      // reason = 'shutdown because error'
    } else {
      responseStatus = 503
      // reason = 'unavailable because stopping'
    }
    clientTracker.stop({ status: responseStatus, reason })
  })

  const requestHandlerTracker = trackRequestHandlers(nodeServer)
  // ensure we don't try to handle request while server is stopping
  registerCleanupCallback(requestHandlerTracker.stop)

  let stoppedResolve
  const stoppedPromise = new Promise((resolve) => {
    stoppedResolve = resolve
  })
  const stop = memoizeOnce(async (reason = STOP_REASON_NOT_SPECIFIED) => {
    status = "stopping"
    onConnectionError = (error) => {
      if (error === reason) {
        return
      }
      if (error && error.code === "ECONNRESET") {
        return
      }
      if (isCancelError(reason)) {
        return
      }
      throw error
    }
    logger.info(`${serverName} stopped because ${reason}`)

    await cleanup(reason)
    await stopListening(nodeServer)
    status = "stopped"
    stoppedCallback({ reason })
    stoppedResolve(reason)
  })
  cancellationToken.register(stop)
  const startOperation = createStoppableOperation({
    cancellationToken,
    start: () => listen({ cancellationToken, server: nodeServer, port, ip }),
    stop: (_, reason) => stop(reason),
  })

  port = await startOperation
  status = "opened"
  const origin = originAsString({ protocol, ip, port })
  logger.info(`${serverName} started at ${origin}`)
  startedCallback({ origin })

  // nodeServer.on("upgrade", (request, socket, head) => {
  //   // when being requested using a websocket
  //   // we could also answr to the request ?
  //   // socket.end([data][, encoding])

  //   console.log("upgrade", { head, request })
  //   console.log("socket", { connecting: socket.connecting, destroyed: socket.destroyed })
  // })

  requestHandlerTracker.add(async (nodeRequest, nodeResponse) => {
    const { request, response, error } = await generateResponseDescription({
      nodeRequest,
      origin,
    })

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
    populateNodeResponse(nodeResponse, response, {
      ignoreBody: request.method === "HEAD",
    })
  })

  const corsEnabled = accessControlAllowRequestOrigin || accessControlAllowedOrigins.length
  // here we check access control options to throw or warn if we find strange values

  const generateResponseDescription = async ({ nodeRequest, origin }) => {
    const request = nodeRequestToRequest(nodeRequest, origin)

    nodeRequest.on("error", (error) => {
      logger.error("error on", request.ressource, error)
    })

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
          request,
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
        request,
        response: responsePropertiesToResponse(responseProperties || {}),
      }
    } catch (error) {
      return {
        request,
        response: composeResponse(
          responsePropertiesToResponse({
            status: 500,
            statusText: STATUS_TEXT_INTERNAL_ERROR,
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

  if (stopOnInternalError) {
    const unregister = requestHandlerTracker.add((nodeRequest, nodeResponse) => {
      if (
        nodeResponse.statusCode === 500 &&
        nodeResponse.statusMessage === STATUS_TEXT_INTERNAL_ERROR
      ) {
        stop(STOP_REASON_INTERNAL_ERROR)
      }
    })
    registerCleanupCallback(unregister)
  }

  return {
    getStatus: () => status,
    origin,
    nodeServer,
    // TODO: remove agent
    agent,
    stop,
    stoppedPromise,
  }
}

const createTracker = () => {
  const callbackArray = []

  const registerCleanupCallback = (callback) => {
    if (typeof callback !== "function")
      throw new TypeError(`callback must be a function
callback: ${callback}`)
    callbackArray.push(callback)
  }

  const cleanup = async (reason) => {
    const localCallbackArray = callbackArray.slice()
    await Promise.all(localCallbackArray.map((callback) => callback(reason)))
  }

  return { registerCleanupCallback, cleanup }
}

const statusToStatusText = (status) => STATUS_CODES[status] || "not specified"

const getNodeServerAndAgent = ({ protocol, privateKey, certificate }) => {
  if (protocol === "http") {
    return {
      nodeServer: createNodeServer(),
      agent: global.Agent,
    }
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

    return {
      nodeServer: createNodeSecureServer({
        key: privateKey,
        cert: certificate,
      }),
      agent: new SecureAgent({
        rejectUnauthorized: false, // allow self signed certificate
      }),
    }
  }

  throw new Error(`unsupported protocol ${protocol}`)
}

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
