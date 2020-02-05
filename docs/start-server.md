# Table of contents

- [startServer example](#startServer-example)
- [startServer parameters](#startServer-parameters)
  - [protocol](#protocol)
    - [https protocol](#https-protocol)
  - [ip](#ip)
  - [port](#port)
  - [forcePort](#forcePort)
  - [requestToResponse](#requestToResponse)
    - [request](#request)
    - [response](#response)
  - [accessControl parameters](#accessControl-parameters)
    - [accessControlAllowedOrigins](#accessControlAllowedOrigins)
    - [accessControlAllowedMethods](#accessControlAllowedMethods)
    - [accessControlAllowedHeaders](#accessControlAllowedHeaders)
    - [accessControlAllowRequestOrigin](#accessControlAllowRequestOrigin)
    - [accessControlAllowRequestMethod](#accessControlAllowRequestMethod)
    - [accessControlAllowRequestHeaders](#accessControlAllowRequestHeaders)
    - [accessControlAllowCredentials](#accessControlAllowCredentials)
    - [accessControlMaxAge](#accessControlMaxAge)
  - [logLevel](#logLevel)
  - [stopOnSIGINT](#stopOnSIGINT)
  - [stopOnExit](#stopOnExit)
  - [stopOnInternalError](#stopOnInternalError)
  - [keepProcessAlive](#keepProcessAlive)
  - [startedCallback](#startedCallback)
  - [stoppedCallback](#stoppedCallback)
- [startServer return value](#startServer-return-value)
  - [origin](#origin)
  - [nodeServer](#nodeServer)
  - [stop](#stop)
  - [stoppedPromise](#stoppedPromise)

# startServer example

`startServer` is an async function starting a server.

```js
import { startServer } from "@jsenv/server"

const server = await startServer({
  protocol: "https",
  ip: "127.0.0.1",
  port: 80,
})
```

— source code at [src/startServer.js](../src/startServer.js).

# startServer parameters

## protocol

`protocol` parameter is a string which ie either `"http"` or `"https"`. This parameter is optional with a default value of `"http"`.

If you use `https` protocol a default self signed certificate will be used. It can be found inside [src/jsenvSignature.js](../src/jsenvSignature.js). You may want to add this certificate to your system/browser trusted certificates.

You can also pass your own certificate using `privateKey` and `certificate` parameters.
The code below is a basic example showing how you could pass your own certificate.

```js
import { readFileSync } from "fs"
import { startServer } from "@jsenv/server"

startServer({
  protocol: "https",
  privateKey: readFileSync(`${__dirname}/ssl/private.pem`),
  certificate: readFileSync(`${__dirname}/ssl/cert.pem`),
})
```

## ip

`ip` parameter is a string representing the ip server will listen. This parameter is optional with a default value of `"127.0.0.1"`.

You can pass an empty string to listen any ip.

## port

`port` parameter is a number representing the port server will listen. This parameter is optional with a default value of `0`.

A value of `0` means server will listen to a random available port. In that case, if you want to know the listened port use [origin](#origin) value returned by startServer.

## forcePort

`forcePort` parameter is a boolean controlling if process using the port will be killed. This parameter is optional with a default value of `false`.

Passing `forcePort` to true when `port` is `0` will throw because it makes no sense.

## requestToResponse

`requestToResponse` parameter is a function responsible to generate a response from a request. This parameter is optional with a default value of `() => null`.

When `requestToResponse` returns `null` or `undefined` server respond to that request with `501 Not implemented`. Below are more information on `request` and `response` objects.

### request

`request` is an object representing an http request. `request` are passed as first argument to `requestToResponse`, see below a `request` example

```js
{
  origin: "http://127.0.0.1:8080",
  ressource: "/index.html?param=1",
  method: "GET",
  headers: { accept: "text/html" },
  body: undefined,
}
```

When underlying http request method is `GET` or `HEAD`, `request.body` is `undefined`.<br />
When underlying http request method is `POST`, `PUT`, `PATCH`, `request.body` is an observable object.

The following code snippet can be used to get `request.body` as string:

```js
const readRequestBodyAsString = (requestBody) => {
  return new Promise((resolve, reject) => {
    const bufferArray = []
    requestBody.subscribe({
      error: reject,
      next: (buffer) => {
        bufferArray.push(buffer)
      },
      complete: () => {
        const bodyAsBuffer = Buffer.concat(bufferArray)
        const bodyAsString = bodyAsBuffer.toString()
        resolve(bodyAsString)
      },
    })
  })
}
```

### response

`response` is an object describing an http response. `response` are returned must be returned by the code you write inside `requestToResponse`, see below some `response` examples:

- response with a body declared with a string

```js
const response = {
  status: 200,
  headers: { "content-type": "text/plain" },
  body: "Hello world",
}
```

- response with a body declared with a buffer

```js
const response = {
  status: 200,
  headers: { "content-type": "text/plain" },
  body: Buffer.from("Hello world"),
}
```

- response with a body declared with a readable stream

```js
const { createReadStream } = require("fs")

const response = {
  status: 200,
  headers: { "content-type": "text/plain" },
  body: createReadStream("/User/you/folder/file.txt"),
}
```

- response with a body declared with an observable body

```js
const response = {
  status: 200,
  headers: { "content-type": "text/plain" },
  body: {
    [Symbol.observable]: () => {
      return {
        subscribe: ({ next, complete }) => {
          next("Hello world")
          complete()
        },
      }
    },
  },
}
```

## accessControl parameters

All parameters starting with `accessControl` are related to cross origin ressource sharing, also called CORS.

As soon as you pass `accessControlAllowRequestOrigin` or `accessControlAllowedOrigins` it means your server use CORS.

When using CORS all your response will contain CORS headers, even a 500 response.

### accessControlAllowedOrigins

`accessControlAllowedOrigins` parameter is an array of origins allowed when requesting your server. This parameter is optional with a default value of `[]`.

### accessControlAllowedMethods

`accessControlAllowedMethods` parameter is an array or methods allowed when requesting your server. This parameter is optional with a default value of `["GET", "POST", "PUT", "DELETE", "OPTIONS"]`

### accessControlAllowedHeaders

`accessControlAllowedHeaders` parameter is an array of headers allowed when requesting your server. This parameter is optional with a default value of `["x-requested-with"]`.

### accessControlAllowRequestOrigin

`accessControlAllowRequestOrigin` parameter is a boolean controlling if request origin is auto allowed. This parameter is optional with a default value of `false`.

Use this parameter to allow any origin.

### accessControlAllowRequestMethod

`accessControlAllowRequestMethod` parameter is a boolean controlling if request method is auto allowed. This parameter is optional with a default value of `false`.

Use this parameter to allowed any request method.

### accessControlAllowRequestHeaders

`accessControlAllowRequestHeaders` parameter is a boolean controlling if request headers are auto allowed. This parameter is optional with a default value of `false`.

Use this parameter to allowed any request headers.

### accessControlAllowCredentials

`accessControlAllowCredentials` parameter is a boolean controlling if request credentials are allowed when requesting your server. This parameter is optional with a default value of `false`.

### accessControlMaxAge

`accessControlMaxAge` parameter is a number representing an amount of seconds that can be used by client to cache access control headers values. This parameter is optional with a default value of `600`.

## logLevel

`logLevel` parameter is a string controlling how much logs server will write in the console. This parameters is otional with a default value of `"info"`.

— see [jsenv/jsenv-logger#logLevel](https://github.com/jsenv/jsenv-logger#logLevel)

## stopOnSIGINT

`stopOnSIGINT` parameter is a boolean controlling if server stops itself when process SIGINT is occurs. This parameters is otional with a default value of `true`.

SIGINT occurs when you hit ctrl+c in your terminal for instance.

## stopOnExit

`stopOnSIGINT` parameter is a boolean controlling if server stops itself when process exits. This parameters is otional with a default value of `true`.

## stopOnInternalError

`stopOnInternalError` parameter is a boolean controlling if server stops itself when `requestToResponse` produce a 500. This parameters is otional with a default value of `false`.

## keepProcessAlive

`keepProcessAlive` parameter is a boolean controlling if server keeps the process alive. This parameters is otional with a default value of `true`.

When false, if nothing keeps the process alive node process will end even if your server is still listening.

## startedCallback

`startedCallback` parameter is a function called when server starts listening. This parameters is otional with a default value of `() => {}`.

`startedCallback` receives one argument being an object with an origin property representing the server origin like `http://127.0.0.1:8080`.

## stoppedCallback

`stoppedCallback` parameter is a function called when server stops. This parameters is otional with a default value of `() => {}`.

`stoppedCallback` receives one argument being an object with a reason property representing why the server stopped.

Each possible `reason` is an object you can import like this:

```js
import {
  STOP_REASON_INTERNAL_ERROR,
  STOP_REASON_PROCESS_SIGHUP,
  STOP_REASON_PROCESS_SIGTERM,
  STOP_REASON_PROCESS_SIGINT,
  STOP_REASON_PROCESS_BEFORE_EXIT,
  STOP_REASON_PROCESS_EXIT,
  STOP_REASON_NOT_SPECIFIED,
} from "@jsenv/server"
```

`reason` might also be a value you passed yourself:

```js
import { startServer } from "@jsenv/server"

const { stop } = await startServer({
  stoppedCallback: ({ reason }) => {
    reason === 42
  },
})
stop(42)
```

# startServer return value

```js
import { startServer } from "@jsenv/server"

const { origin, nodeServer, stop, stoppedPromise } = await startServer()
```

## origin

`origin` is a string representing the url server is listening to.

An example value could be `"http://127.0.0.1:65289"`

## nodeServer

`nodeServer` is the http_server instance used internally by the server. It exists in case you need to do something on the node server itself.

— see [http_server documentation on node.js](https://nodejs.org/api/http.html#http_class_http_server)

## stop

`stop` is an async function asking server to be stopped.

Stop returns a promise resolved when server is completely stopped.

If you call stop without argument, promise is resolved with `STOP_REASON_NOT_SPECIFIED`, otherwise it is resolved with the value your provided.

## stoppedPromise

`stoppedPromise` is a promise resolved with a reason when server is stopped.

`stoppedPromise` exists because server can be stopped calling `stop` or automatically by parameters like [stopOnSIGINT](#stopOnSIGINT).
