'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var net = require('net');
var path = require('path');
var fs = require('fs');
var url$1 = require('url');
var crypto = require('crypto');
var util = require('util');
var http = require('http');
var https = require('https');
var module$1 = require('module');
var stream = require('stream');

const acceptsContentType = (acceptHeader, contentType) => {
  if (typeof acceptHeader !== "string") {
    return false;
  }

  return acceptHeader.split(",").some(acceptRaw => {
    const accept = parseAccept(acceptRaw);
    return typeMatches(contentType, accept.type);
  });
};

const parseAccept = accept => {
  const acceptTrimmed = accept.trim();
  const scoreIndex = acceptTrimmed.indexOf(";q=");
  let type;
  let score;

  if (scoreIndex > -1) {
    const beforeScore = acceptTrimmed.slice(0, scoreIndex);
    const afterScore = acceptTrimmed.slice(scoreIndex + ";q=".length);
    type = beforeScore;
    score = parseFloat(afterScore);
  } else {
    type = acceptTrimmed;
    score = 1;
  }

  return {
    type,
    score
  };
};

const typeMatches = (type, pattern) => {
  const typeComposition = decomposeType(type);
  const patternComposition = decomposeType(pattern);

  if (patternComposition.type === "*") {
    if (patternComposition.subtype === "*") return true;
    return patternComposition.subtype === typeComposition.subtype;
  }

  if (patternComposition.type === typeComposition.type) {
    if (patternComposition.subtype === "*") return true;
    return patternComposition.subtype === typeComposition.subtype;
  }

  return false;
};

const decomposeType = fullType => {
  const parts = fullType.split("/");
  const type = parts[0];
  const subtype = parts[1];
  return {
    type,
    subtype
  };
};

const compositionMappingToComposeStrict = (compositionMapping, createInitial = () => ({})) => {
  const reducer = compositionMappingToStrictReducer(compositionMapping);
  return (...objects) => objects.reduce(reducer, createInitial());
};

const compositionMappingToStrictReducer = compositionMapping => {
  const propertyComposeStrict = (key, previous, current) => {
    const propertyExistInCurrent = key in current;
    if (!propertyExistInCurrent) return previous[key];
    const propertyExistInPrevious = key in previous;
    if (!propertyExistInPrevious) return current[key];
    const composeProperty = compositionMapping[key];
    return composeProperty(previous[key], current[key]);
  };

  return (previous, current) => {
    if (typeof current !== "object" || current === null) return previous;
    const composed = {};
    Object.keys(compositionMapping).forEach(key => {
      composed[key] = propertyComposeStrict(key, previous, current);
    });
    return composed;
  };
};

const compositionMappingToCompose = (compositionMapping, createInitial = () => ({})) => {
  const reducer = compositionMappingToReducer(compositionMapping);
  return (...objects) => objects.reduce(reducer, createInitial());
};

const compositionMappingToReducer = compositionMapping => {
  const composeProperty = (key, previous, current) => {
    const propertyExistInCurrent = key in current;
    if (!propertyExistInCurrent) return previous[key];
    const propertyExistInPrevious = key in previous;
    if (!propertyExistInPrevious) return current[key];
    const propertyHasComposer = key in compositionMapping;
    if (!propertyHasComposer) return current[key];
    const composerForProperty = compositionMapping[key];
    return composerForProperty(previous[key], current[key]);
  };

  return (previous, current) => {
    if (typeof current !== "object" || current === null) return previous;
    const composed = { ...previous
    };
    Object.keys(current).forEach(key => {
      composed[key] = composeProperty(key, previous, current);
    });
    return composed;
  };
};

const composeHeaderValues = (value, nextValue) => {
  const headerValues = value.split(", ");
  nextValue.split(", ").forEach(value => {
    if (!headerValues.includes(value)) {
      headerValues.push(value);
    }
  });
  return headerValues.join(", ");
};

const headerCompositionMapping = {
  "accept": composeHeaderValues,
  "accept-charset": composeHeaderValues,
  "accept-language": composeHeaderValues,
  "access-control-allow-headers": composeHeaderValues,
  "access-control-allow-methods": composeHeaderValues,
  "access-control-allow-origin": composeHeaderValues,
  // 'content-type', // https://github.com/ninenines/cowboy/issues/1230
  "vary": composeHeaderValues
};
const composeResponseHeaders = compositionMappingToCompose(headerCompositionMapping);

const responseCompositionMapping = {
  status: (prevStatus, status) => status,
  statusText: (prevStatusText, statusText) => statusText,
  headers: composeResponseHeaders,
  body: (prevBody, body) => body,
  bodyEncoding: (prevEncoding, encoding) => encoding
};
const composeResponse = compositionMappingToComposeStrict(responseCompositionMapping);

const convertFileSystemErrorToResponseProperties = error => {
  // https://iojs.org/api/errors.html#errors_eacces_permission_denied
  if (isErrorWithCode(error, "EACCES")) {
    return {
      status: 403,
      statusText: "no permission to read file"
    };
  }

  if (isErrorWithCode(error, "EPERM")) {
    return {
      status: 403,
      statusText: "no permission to read file"
    };
  }

  if (isErrorWithCode(error, "ENOENT")) {
    return {
      status: 404,
      statusText: "file not found"
    };
  } // file access may be temporarily blocked
  // (by an antivirus scanning it because recently modified for instance)


  if (isErrorWithCode(error, "EBUSY")) {
    return {
      status: 503,
      statusText: "file is busy",
      headers: {
        "retry-after": 0.01 // retry in 10ms

      }
    };
  } // emfile means there is too many files currently opened


  if (isErrorWithCode(error, "EMFILE")) {
    return {
      status: 503,
      statusText: "too many file opened",
      headers: {
        "retry-after": 0.1 // retry in 100ms

      }
    };
  }

  if (isErrorWithCode(error, "EISDIR")) {
    return {
      status: 500,
      statusText: "Unexpected directory operation"
    };
  }

  return Promise.reject(error);
};

const isErrorWithCode = (error, code) => {
  return typeof error === "object" && error.code === code;
};

const LOG_LEVEL_OFF = "off";
const LOG_LEVEL_DEBUG = "debug";
const LOG_LEVEL_INFO = "info";
const LOG_LEVEL_WARN = "warn";
const LOG_LEVEL_ERROR = "error";

const createLogger = ({
  logLevel = LOG_LEVEL_INFO
} = {}) => {
  if (logLevel === LOG_LEVEL_DEBUG) {
    return {
      debug,
      info,
      warn,
      error
    };
  }

  if (logLevel === LOG_LEVEL_INFO) {
    return {
      debug: debugDisabled,
      info,
      warn,
      error
    };
  }

  if (logLevel === LOG_LEVEL_WARN) {
    return {
      debug: debugDisabled,
      info: infoDisabled,
      warn,
      error
    };
  }

  if (logLevel === LOG_LEVEL_ERROR) {
    return {
      debug: debugDisabled,
      info: infoDisabled,
      warn: warnDisabled,
      error
    };
  }

  if (logLevel === LOG_LEVEL_OFF) {
    return {
      debug: debugDisabled,
      info: infoDisabled,
      warn: warnDisabled,
      error: errorDisabled
    };
  }

  throw new Error(`unexpected logLevel.
--- logLevel ---
${logLevel}
--- allowed log levels ---
${LOG_LEVEL_OFF}
${LOG_LEVEL_ERROR}
${LOG_LEVEL_WARN}
${LOG_LEVEL_INFO}
${LOG_LEVEL_DEBUG}`);
};
const debug = console.debug;

const debugDisabled = () => {};

const info = console.info;

const infoDisabled = () => {};

const warn = console.warn;

const warnDisabled = () => {};

const error = console.error;

const errorDisabled = () => {};

if ("observable" in Symbol === false) {
  Symbol.observable = Symbol.for("observable");
}

const createObservable = ({
  subscribe
}) => {
  const observable = {
    [Symbol.observable]: () => observable,
    subscribe
  };
  return observable;
};
const subscribe = (observable, {
  next = () => {},
  error = value => {
    throw value;
  },
  complete = () => {}
}) => {
  const {
    subscribe
  } = observable[Symbol.observable]();
  const subscription = subscribe({
    next,
    error,
    complete
  });
  return subscription;
};
const isObservable = value => {
  if (value === null) return false;
  if (value === undefined) return false;
  if (typeof value === "object") return Symbol.observable in value;
  if (typeof value === "function") return Symbol.observable in value;
  return false;
};

const createSSERoom = ({
  logLevel,
  keepaliveDuration = 30 * 1000,
  retryDuration = 1 * 1000,
  historyLength = 1 * 1000,
  maxConnectionAllowed = 100 // max 100 users accepted

} = {}) => {
  const logger = createLogger({
    logLevel
  });
  const connections = new Set(); // what about history that keeps growing ?
  // we should add some limit
  // one limit could be that an event older than 24h is be deleted

  const history = createEventHistory(historyLength);
  let previousEventId;
  let state = "closed";
  let interval;

  const connect = lastKnownId => {
    if (connections.size > maxConnectionAllowed) {
      return {
        status: 503
      };
    }

    if (state === "closed") {
      return {
        status: 204
      };
    }

    const joinEvent = {
      id: previousEventId === undefined ? 0 : previousEventId + 1,
      retry: retryDuration,
      type: "join",
      data: new Date().toLocaleTimeString()
    };
    previousEventId = joinEvent.id;
    history.add(joinEvent);
    const events = [joinEvent, // send events which occured between lastKnownId & now
    ...(lastKnownId === undefined ? [] : history.since(lastKnownId))];
    const body = createObservable({
      subscribe: ({
        next
      }) => {
        events.forEach(event => {
          logger.debug(`send ${event.type} event to this new client`);
          next(stringifySourceEvent(event));
        });
        const connection = {
          write: next
        };

        const unsubscribe = () => {
          connections.delete(connection);
          logger.debug(`connection closed by us, number of client connected to event source: ${connections.size}`);
        };

        connection.unsubscribe = unsubscribe;
        connections.add(connection);
        return {
          unsubscribe
        };
      }
    });
    logger.debug(`client joined, number of client connected to event source: ${connections.size}, max allowed: ${maxConnectionAllowed}`);
    return {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive"
      },
      body
    };
  };

  const write = data => {
    connections.forEach(connection => {
      connection.write(data);
    });
  };

  const sendEvent = event => {
    if (event.type !== "comment") {
      logger.debug(`send ${event.type} event, number of client listening event source: ${connections.size}`);
      event.id = previousEventId === undefined ? 0 : previousEventId + 1;
      previousEventId = event.id;
      history.add(event);
    }

    write(stringifySourceEvent(event));
  };

  const keepAlive = () => {
    // maybe that, when an event occurs, we can delay the keep alive event
    logger.debug(`send keep alive event, number of client listening event source: ${connections.size}`);
    sendEvent({
      type: "comment",
      data: new Date().toLocaleTimeString()
    });
  };

  const start = () => {
    state = "started";
    interval = setInterval(keepAlive, keepaliveDuration);
  };

  const stop = () => {
    logger.debug(`stopping, number of client to close: ${connections.size}`);
    connections.forEach(connection => connection.unsubscribe());
    clearInterval(interval);
    history.reset();
    state = "stopped";
  };

  return {
    start,
    stop,
    connect,
    sendEvent
  };
}; // https://github.com/dmail-old/project/commit/da7d2c88fc8273850812972885d030a22f9d7448
// https://github.com/dmail-old/project/commit/98b3ae6748d461ac4bd9c48944a551b1128f4459
// https://github.com/dmail-old/http-eventsource/blob/master/lib/event-source.js
// http://html5doctor.com/server-sent-events/

const stringifySourceEvent = ({
  data,
  type = "message",
  id,
  retry
}) => {
  let string = "";

  if (id !== undefined) {
    string += `id:${id}\n`;
  }

  if (retry) {
    string += `retry:${retry}\n`;
  }

  if (type !== "message") {
    string += `event:${type}\n`;
  }

  string += `data:${data}\n\n`;
  return string;
};

const createEventHistory = ({
  limit
} = {}) => {
  const events = [];
  let removedCount = 0;

  const add = data => {
    events.push(data);

    if (events.length >= limit) {
      events.shift();
      removedCount++;
    }
  };

  const since = index => {
    index = parseInt(index);

    if (isNaN(index)) {
      throw new TypeError("history.since() expect a number");
    }

    index -= removedCount;
    return index < 0 ? [] : events.slice(index);
  };

  const reset = () => {
    events.length = 0;
    removedCount = 0;
  };

  return {
    add,
    since,
    reset
  };
};

const createCancellationToken = () => {
  const register = callback => {
    if (typeof callback !== "function") {
      throw new Error(`callback must be a function, got ${callback}`);
    }

    return {
      callback,
      unregister: () => {}
    };
  };

  const throwIfRequested = () => undefined;

  return {
    register,
    cancellationRequested: false,
    throwIfRequested
  };
};

const memoizeOnce = compute => {
  let locked = false;
  let lockValue;

  const memoized = (...args) => {
    if (locked) return lockValue; // if compute is recursive wait for it to be fully done before storing the lockValue
    // so set locked later

    lockValue = compute(...args);
    locked = true;
    return lockValue;
  };

  memoized.deleteCache = () => {
    const value = lockValue;
    locked = false;
    lockValue = undefined;
    return value;
  };

  return memoized;
};

const createOperation = ({
  cancellationToken = createCancellationToken(),
  start,
  ...rest
}) => {
  const unknownArgumentNames = Object.keys(rest);

  if (unknownArgumentNames.length) {
    throw new Error(`createOperation called with unknown argument names.
--- unknown argument names ---
${unknownArgumentNames}
--- possible argument names ---
cancellationToken
start`);
  }

  cancellationToken.throwIfRequested();
  const promise = new Promise(resolve => {
    resolve(start());
  });
  const cancelPromise = new Promise((resolve, reject) => {
    const cancelRegistration = cancellationToken.register(cancelError => {
      cancelRegistration.unregister();
      reject(cancelError);
    });
    promise.then(cancelRegistration.unregister, () => {});
  });
  const operationPromise = Promise.race([promise, cancelPromise]);
  return operationPromise;
};

const createStoppableOperation = ({
  cancellationToken = createCancellationToken(),
  start,
  stop,
  ...rest
}) => {
  if (typeof stop !== "function") {
    throw new TypeError(`stop must be a function. got ${stop}`);
  }

  const unknownArgumentNames = Object.keys(rest);

  if (unknownArgumentNames.length) {
    throw new Error(`createStoppableOperation called with unknown argument names.
--- unknown argument names ---
${unknownArgumentNames}
--- possible argument names ---
cancellationToken
start
stop`);
  }

  cancellationToken.throwIfRequested();
  const promise = new Promise(resolve => {
    resolve(start());
  });
  const cancelPromise = new Promise((resolve, reject) => {
    const cancelRegistration = cancellationToken.register(cancelError => {
      cancelRegistration.unregister();
      reject(cancelError);
    });
    promise.then(cancelRegistration.unregister, () => {});
  });
  const operationPromise = Promise.race([promise, cancelPromise]);
  const stopInternal = memoizeOnce(async reason => {
    const value = await promise;
    return stop(value, reason);
  });
  cancellationToken.register(stopInternal);
  operationPromise.stop = stopInternal;
  return operationPromise;
};

const firstOperationMatching = ({
  array,
  start,
  predicate
}) => {
  if (typeof array !== "object") {
    throw new TypeError(`array must be an object, got ${array}`);
  }

  if (typeof start !== "function") {
    throw new TypeError(`start must be a function, got ${start}`);
  }

  if (typeof predicate !== "function") {
    throw new TypeError(`predicate must be a function, got ${predicate}`);
  }

  return new Promise((resolve, reject) => {
    const visit = index => {
      if (index >= array.length) {
        return resolve();
      }

      const input = array[index];
      const returnValue = start(input);
      return Promise.resolve(returnValue).then(output => {
        if (predicate(output)) {
          return resolve(output);
        }

        return visit(index + 1);
      }, reject);
    };

    visit(0);
  });
};

const listen = ({
  cancellationToken,
  server,
  port,
  ip
}) => {
  return createStoppableOperation({
    cancellationToken,
    start: () => startListening(server, port, ip),
    stop: () => stopListening(server)
  });
};
const startListening = (server, port, ip) => new Promise((resolve, reject) => {
  server.on("error", reject);
  server.on("listening", () => {
    // in case port is 0 (randomly assign an available port)
    // https://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback
    resolve(server.address().port);
  });
  server.listen(port, ip);
});
const stopListening = server => new Promise((resolve, reject) => {
  server.on("error", reject);
  server.on("close", resolve);
  server.close();
});

const findFreePort = async (initialPort = 1, {
  cancellationToken = createCancellationToken(),
  ip = "127.0.0.1",
  min = 1,
  max = 65534,
  next = port => port + 1
} = {}) => {
  const testUntil = async (port, ip) => {
    const free = await portIsFree({
      cancellationToken,
      port,
      ip
    });

    if (free) {
      return port;
    }

    const nextPort = next(port);

    if (nextPort > max) {
      throw new Error(`${ip} has no available port between ${min} and ${max}`);
    }

    return testUntil(nextPort, ip);
  };

  return testUntil(initialPort, ip);
};

const portIsFree = async ({
  cancellationToken,
  port,
  ip
}) => {
  const server = net.createServer();
  const listenOperation = listen({
    cancellationToken,
    server,
    port,
    ip
  });
  return listenOperation.then(() => {
    const stopPromise = listenOperation.stop(); // cancellation must wait for server to be closed before considering
    // cancellation as done

    cancellationToken.register(() => stopPromise);
    return stopPromise.then(() => true);
  }, error => {
    if (error && error.code === "EADDRINUSE") {
      return false;
    }

    if (error && error.code === "EACCES") {
      return false;
    }

    return Promise.reject(error);
  });
};

const firstService = (...callbacks) => {
  return firstOperationMatching({
    array: callbacks,
    start: callback => callback(),
    predicate: serviceGeneratedResponsePredicate
  });
};

const serviceGeneratedResponsePredicate = value => {
  if (value === null) {
    return false;
  }

  return typeof value === "object";
};

const jsenvAccessControlAllowedHeaders = ["x-requested-with"];

const jsenvAccessControlAllowedMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];

const jsenvPrivateKey = `-----BEGIN RSA PRIVATE KEY-----
MIICXAIBAAKBgQCll1gJkJqB+KRZsyepQ7gs81UO+73aKPaNbjp/dwo9XfqvNdDp
Ki4zfTwzzJyFXkoN+NGihfQHI+VqRGITc+XzmBPcGu9XIvYy52lV3zjG4sldz+r8
iNBzFwFSdUGmaHfkcm0YhvcjdRhyKalDaLMc3pVX4dq9rRzqm+pkbzVfVQIDAQAB
AoGAImSo2HO8Y7ptCGR5nGKAYnW3+QC4khNoAkAezlK/Qbe/VZzr40Hrjq44Ttn0
uI64+uXvRL5lzQXbpJLHfBraa8J6Vstf2Kwadmg+FyrqBcet6gidqZ6S1LBTfXII
eSUcMIqkourv7LWOs8BfWQQiCf0Em0shGK1qf1lgiOQxoJECQQD+dSJOPqKbdZfJ
/JcsInf5dPkfTNZMhBxpxqiYOvU3684W3LHB1g6BXjHmIF/CIrxcAHsxxXwTGWu9
23Ffu+xPAkEApphOt+CzGdYq+Ygjj6Hq+hx3hkUwKUHSEOcNXG0Eb90m2sCEkXgz
xH7fKYXaohFtis7IFJR4UfYD8pkGYVmdGwJAJf/iFqM9709ZUp25CatAFW3Fgkoc
OqMEBzvWk51CX46EYV+l4BeSZPlnJEGzay96x5Z+z0j5pXSHZXvu62gJ+wJACci+
LsxymFzcr0UQmZnv2/qaBne/yVyFQtrfDQOWFB/P7V8LKiP+Hlc5Mg4bdhNB9LoK
RDMoEeA6ASB9oHAL6wJBAJcYLOICBVQrTil6DroEkrIxQY/S+arKc42uFpj98S+w
k3doJf8KKDrclaRnKfMXxGYhXPUWFpa5fFr1hvcprEo=
-----END RSA PRIVATE KEY-----`;
const jsenvPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCll1gJkJqB+KRZsyepQ7gs81UO
+73aKPaNbjp/dwo9XfqvNdDpKi4zfTwzzJyFXkoN+NGihfQHI+VqRGITc+XzmBPc
Gu9XIvYy52lV3zjG4sldz+r8iNBzFwFSdUGmaHfkcm0YhvcjdRhyKalDaLMc3pVX
4dq9rRzqm+pkbzVfVQIDAQAB
-----END PUBLIC KEY-----`;
const jsenvCertificate = `-----BEGIN CERTIFICATE-----
MIIDEDCCAnmgAwIBAgIQd9Gto4GPGwXcLk0flq7bsjANBgkqhkiG9w0BAQsFADCB
kTEuMCwGA1UEAxMlaHR0cHM6Ly9naXRodWIuY29tL2pzZW52L2pzZW52LXNlcnZl
cjELMAkGA1UEBhMCRlIxGDAWBgNVBAgTD0FscGVzIE1hcml0aW1lczERMA8GA1UE
BxMIVmFsYm9ubmUxDjAMBgNVBAoTBWpzZW52MRUwEwYDVQQLEwxqc2VudiBzZXJ2
ZXIwHhcNMTkwNzA5MTQ1MzU4WhcNMjgwNzA5MTQ1MzU5WjCBkTEuMCwGA1UEAxMl
aHR0cHM6Ly9naXRodWIuY29tL2pzZW52L2pzZW52LXNlcnZlcjELMAkGA1UEBhMC
RlIxGDAWBgNVBAgTD0FscGVzIE1hcml0aW1lczERMA8GA1UEBxMIVmFsYm9ubmUx
DjAMBgNVBAoTBWpzZW52MRUwEwYDVQQLEwxqc2VudiBzZXJ2ZXIwgZ8wDQYJKoZI
hvcNAQEBBQADgY0AMIGJAoGBAKWXWAmQmoH4pFmzJ6lDuCzzVQ77vdoo9o1uOn93
Cj1d+q810OkqLjN9PDPMnIVeSg340aKF9Acj5WpEYhNz5fOYE9wa71ci9jLnaVXf
OMbiyV3P6vyI0HMXAVJ1QaZod+RybRiG9yN1GHIpqUNosxzelVfh2r2tHOqb6mRv
NV9VAgMBAAGjZzBlMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgWgMBMGA1Ud
JQQMMAoGCCsGAQUFBwMBMB8GA1UdIwQYMBaAFOQhJA9S7idbpNIbvKMyeRWbwyad
MA8GA1UdEQQIMAaHBH8AAAEwDQYJKoZIhvcNAQELBQADgYEAUKPupneUl1bdjbbf
QvUqAExIK0Nv2u54X8l0EJvkdPMNQEer7Npzg5RQWExtvamfEZI1EPOeVfPVu5sz
q4DB6OgAEzkytbKtcgPlhY0GDbim8ELCpO1JNDn/jUXH74VJElwXMZqan5VaQ5c+
qsCeVUdw8QsfIZH6XbkvhCswh4k=
-----END CERTIFICATE-----`;

const jsenvContentTypeMap = {
  "application/javascript": {
    extensions: ["js", "mjs", "ts", "jsx"]
  },
  "application/json": {
    extensions: ["json"]
  },
  "application/octet-stream": {},
  "application/pdf": {
    extensions: ["pdf"]
  },
  "application/xml": {
    extensions: ["xml"]
  },
  "application/x-gzip": {
    extensions: ["gz"]
  },
  "application/wasm": {
    extensions: ["wasm"]
  },
  "application/zip": {
    extensions: ["zip"]
  },
  "audio/basic": {
    extensions: ["au", "snd"]
  },
  "audio/mpeg": {
    extensions: ["mpga", "mp2", "mp2a", "mp3", "m2a", "m3a"]
  },
  "audio/midi": {
    extensions: ["midi", "mid", "kar", "rmi"]
  },
  "audio/mp4": {
    extensions: ["m4a", "mp4a"]
  },
  "audio/ogg": {
    extensions: ["oga", "ogg", "spx"]
  },
  "audio/webm": {
    extensions: ["weba"]
  },
  "audio/x-wav": {
    extensions: ["wav"]
  },
  "font/ttf": {
    extensions: ["ttf"]
  },
  "font/woff": {
    extensions: ["woff"]
  },
  "font/woff2": {
    extensions: ["woff2"]
  },
  "image/png": {
    extensions: ["png"]
  },
  "image/gif": {
    extensions: ["gif"]
  },
  "image/jpeg": {
    extensions: ["jpg"]
  },
  "image/svg+xml": {
    extensions: ["svg", "svgz"]
  },
  "text/plain": {
    extensions: ["txt"]
  },
  "text/html": {
    extensions: ["html"]
  },
  "text/css": {
    extensions: ["css"]
  },
  "text/cache-manifest": {
    extensions: ["appcache"]
  },
  "video/mp4": {
    extensions: ["mp4", "mp4v", "mpg4"]
  },
  "video/mpeg": {
    extensions: ["mpeg", "mpg", "mpe", "m1v", "m2v"]
  },
  "video/ogg": {
    extensions: ["ogv"]
  },
  "video/webm": {
    extensions: ["webm"]
  }
};

// https://github.com/jshttp/mime-db/blob/master/src/apache-types.json
const urlToContentType = (url, contentTypeMap = jsenvContentTypeMap, contentTypeDefault = "application/octet-stream") => {
  if (typeof contentTypeMap !== "object") {
    throw new TypeError(`contentTypeMap must be an object, got ${contentTypeMap}`);
  }

  const pathname = new URL(url).pathname;
  const extensionWithDot = path.extname(pathname);

  if (!extensionWithDot || extensionWithDot === ".") {
    return contentTypeDefault;
  }

  const extension = extensionWithDot.slice(1);
  const availableContentTypes = Object.keys(contentTypeMap);
  const contentTypeForExtension = availableContentTypes.find(contentTypeName => {
    const contentType = contentTypeMap[contentTypeName];
    return contentType.extensions && contentType.extensions.indexOf(extension) > -1;
  });
  return contentTypeForExtension || contentTypeDefault;
};

const urlToSearchParamValue = (url, searchParamName) => {
  return new URL(url).searchParams.get(searchParamName);
};

const ensureUrlTrailingSlash = url => {
  return url.endsWith("/") ? url : `${url}/`;
};

const isFileSystemPath = value => {
  if (typeof value !== "string") {
    throw new TypeError(`isFileSystemPath first arg must be a string, got ${value}`);
  }

  if (value[0] === "/") return true;
  return startsWithWindowsDriveLetter(value);
};

const startsWithWindowsDriveLetter = string => {
  const firstChar = string[0];
  if (!/[a-zA-Z]/.test(firstChar)) return false;
  const secondChar = string[1];
  if (secondChar !== ":") return false;
  return true;
};

const fileSystemPathToUrl = value => {
  if (!isFileSystemPath(value)) {
    throw new Error(`received an invalid value for fileSystemPath: ${value}`);
  }

  return String(url$1.pathToFileURL(value));
};

const assertAndNormalizeDirectoryUrl = value => {
  let urlString;

  if (value instanceof URL) {
    urlString = value.href;
  } else if (typeof value === "string") {
    if (isFileSystemPath(value)) {
      urlString = fileSystemPathToUrl(value);
    } else {
      try {
        urlString = String(new URL(value));
      } catch (e) {
        throw new TypeError(`directoryUrl must be a valid url, received ${value}`);
      }
    }
  } else {
    throw new TypeError(`directoryUrl must be a string or an url, received ${value}`);
  }

  if (!urlString.startsWith("file://")) {
    throw new Error(`directoryUrl must starts with file://, received ${value}`);
  }

  return ensureUrlTrailingSlash(urlString);
};

const assertAndNormalizeFileUrl = (value, baseUrl) => {
  let urlString;

  if (value instanceof URL) {
    urlString = value.href;
  } else if (typeof value === "string") {
    if (isFileSystemPath(value)) {
      urlString = fileSystemPathToUrl(value);
    } else {
      try {
        urlString = String(new URL(value, baseUrl));
      } catch (e) {
        throw new TypeError(`fileUrl must be a valid url, received ${value}`);
      }
    }
  } else {
    throw new TypeError(`fileUrl must be a string or an url, received ${value}`);
  }

  if (!urlString.startsWith("file://")) {
    throw new Error(`fileUrl must starts with file://, received ${value}`);
  }

  return urlString;
};

const urlToFileSystemPath = fileUrl => {
  if (fileUrl[fileUrl.length - 1] === "/") {
    // remove trailing / so that nodejs path becomes predictable otherwise it logs
    // the trailing slash on linux but does not on windows
    fileUrl = fileUrl.slice(0, -1);
  }

  const fileSystemPath = url$1.fileURLToPath(fileUrl);
  return fileSystemPath;
};

// https://github.com/coderaiser/cloudcmd/issues/63#issuecomment-195478143
// https://nodejs.org/api/fs.html#fs_file_modes
// https://github.com/TooTallNate/stat-mode
// cannot get from fs.constants because they are not available on windows
const S_IRUSR = 256;
/* 0000400 read permission, owner */

const S_IWUSR = 128;
/* 0000200 write permission, owner */

const S_IXUSR = 64;
/* 0000100 execute/search permission, owner */

const S_IRGRP = 32;
/* 0000040 read permission, group */

const S_IWGRP = 16;
/* 0000020 write permission, group */

const S_IXGRP = 8;
/* 0000010 execute/search permission, group */

const S_IROTH = 4;
/* 0000004 read permission, others */

const S_IWOTH = 2;
/* 0000002 write permission, others */

const S_IXOTH = 1;
const permissionsToBinaryFlags = ({
  owner,
  group,
  others
}) => {
  let binaryFlags = 0;
  if (owner.read) binaryFlags |= S_IRUSR;
  if (owner.write) binaryFlags |= S_IWUSR;
  if (owner.execute) binaryFlags |= S_IXUSR;
  if (group.read) binaryFlags |= S_IRGRP;
  if (group.write) binaryFlags |= S_IWGRP;
  if (group.execute) binaryFlags |= S_IXGRP;
  if (others.read) binaryFlags |= S_IROTH;
  if (others.write) binaryFlags |= S_IWOTH;
  if (others.execute) binaryFlags |= S_IXOTH;
  return binaryFlags;
};

const writeFileSystemNodePermissions = async (source, permissions) => {
  const sourceUrl = assertAndNormalizeFileUrl(source);
  const sourcePath = urlToFileSystemPath(sourceUrl);
  let binaryFlags;

  if (typeof permissions === "object") {
    permissions = {
      owner: {
        read: getPermissionOrComputeDefault("read", "owner", permissions),
        write: getPermissionOrComputeDefault("write", "owner", permissions),
        execute: getPermissionOrComputeDefault("execute", "owner", permissions)
      },
      group: {
        read: getPermissionOrComputeDefault("read", "group", permissions),
        write: getPermissionOrComputeDefault("write", "group", permissions),
        execute: getPermissionOrComputeDefault("execute", "group", permissions)
      },
      others: {
        read: getPermissionOrComputeDefault("read", "others", permissions),
        write: getPermissionOrComputeDefault("write", "others", permissions),
        execute: getPermissionOrComputeDefault("execute", "others", permissions)
      }
    };
    binaryFlags = permissionsToBinaryFlags(permissions);
  } else {
    binaryFlags = permissions;
  }

  return chmodNaive(sourcePath, binaryFlags);
};

const chmodNaive = (fileSystemPath, binaryFlags) => {
  return new Promise((resolve, reject) => {
    fs.chmod(fileSystemPath, binaryFlags, error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

const actionLevels = {
  read: 0,
  write: 1,
  execute: 2
};
const subjectLevels = {
  others: 0,
  group: 1,
  owner: 2
};

const getPermissionOrComputeDefault = (action, subject, permissions) => {
  if (subject in permissions) {
    const subjectPermissions = permissions[subject];

    if (action in subjectPermissions) {
      return subjectPermissions[action];
    }

    const actionLevel = actionLevels[action];
    const actionFallback = Object.keys(actionLevels).find(actionFallbackCandidate => actionLevels[actionFallbackCandidate] > actionLevel && actionFallbackCandidate in subjectPermissions);

    if (actionFallback) {
      return subjectPermissions[actionFallback];
    }
  }

  const subjectLevel = subjectLevels[subject]; // do we have a subject with a stronger level (group or owner)
  // where we could read the action permission ?

  const subjectFallback = Object.keys(subjectLevels).find(subjectFallbackCandidate => subjectLevels[subjectFallbackCandidate] > subjectLevel && subjectFallbackCandidate in permissions);

  if (subjectFallback) {
    const subjectPermissions = permissions[subjectFallback];
    return action in subjectPermissions ? subjectPermissions[action] : getPermissionOrComputeDefault(action, subjectFallback, permissions);
  }

  return false;
};

const isWindows = process.platform === "win32";
const readFileSystemNodeStat = async (source, {
  nullIfNotFound = false,
  followLink = true
} = {}) => {
  if (source.endsWith("/")) source = source.slice(0, -1);
  const sourceUrl = assertAndNormalizeFileUrl(source);
  const sourcePath = urlToFileSystemPath(sourceUrl);
  const handleNotFoundOption = nullIfNotFound ? {
    handleNotFoundError: () => null
  } : {};
  return readStat(sourcePath, {
    followLink,
    ...handleNotFoundOption,
    ...(isWindows ? {
      // Windows can EPERM on stat
      handlePermissionDeniedError: async error => {
        // unfortunately it means we mutate the permissions
        // without being able to restore them to the previous value
        // (because reading current permission would also throw)
        try {
          await writeFileSystemNodePermissions(sourceUrl, 0o666);
          const stats = await readStat(sourcePath, {
            followLink,
            ...handleNotFoundOption,
            // could not fix the permission error, give up and throw original error
            handlePermissionDeniedError: () => {
              throw error;
            }
          });
          return stats;
        } catch (e) {
          // failed to write permission or readState, throw original error as well
          throw error;
        }
      }
    } : {})
  });
};

const readStat = (sourcePath, {
  followLink,
  handleNotFoundError = null,
  handlePermissionDeniedError = null
} = {}) => {
  const nodeMethod = followLink ? fs.stat : fs.lstat;
  return new Promise((resolve, reject) => {
    nodeMethod(sourcePath, (error, statsObject) => {
      if (error) {
        if (handlePermissionDeniedError && (error.code === "EPERM" || error.code === "EACCES")) {
          resolve(handlePermissionDeniedError(error));
        } else if (handleNotFoundError && error.code === "ENOENT") {
          resolve(handleNotFoundError(error));
        } else {
          reject(error);
        }
      } else {
        resolve(statsObject);
      }
    });
  });
};

const ETAG_FOR_EMPTY_CONTENT = '"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"';
const bufferToEtag = buffer => {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError(`buffer expected, got ${buffer}`);
  }

  if (buffer.length === 0) {
    return ETAG_FOR_EMPTY_CONTENT;
  }

  const hash = crypto.createHash("sha1");
  hash.update(buffer, "utf8");
  const hashBase64String = hash.digest("base64");
  const hashBase64StringSubset = hashBase64String.slice(0, 27);
  const length = buffer.length;
  return `"${length.toString(16)}-${hashBase64StringSubset}"`;
};

const readDirectory = async (url, {
  emfileMaxWait = 1000
} = {}) => {
  const directoryUrl = assertAndNormalizeDirectoryUrl(url);
  const directoryPath = urlToFileSystemPath(directoryUrl);
  const startMs = Date.now();
  let attemptCount = 0;

  const attempt = () => {
    return readdirNaive(directoryPath, {
      handleTooManyFilesOpenedError: async error => {
        attemptCount++;
        const nowMs = Date.now();
        const timeSpentWaiting = nowMs - startMs;

        if (timeSpentWaiting > emfileMaxWait) {
          throw error;
        }

        return new Promise(resolve => {
          setTimeout(() => {
            resolve(attempt());
          }, attemptCount);
        });
      }
    });
  };

  return attempt();
};

const readdirNaive = (directoryPath, {
  handleTooManyFilesOpenedError = null
} = {}) => {
  return new Promise((resolve, reject) => {
    fs.readdir(directoryPath, (error, names) => {
      if (error) {
        // https://nodejs.org/dist/latest-v13.x/docs/api/errors.html#errors_common_system_errors
        if (handleTooManyFilesOpenedError && (error.code === "EMFILE" || error.code === "ENFILE")) {
          resolve(handleTooManyFilesOpenedError(error));
        } else {
          reject(error);
        }
      } else {
        resolve(names);
      }
    });
  });
};

const isWindows$1 = process.platform === "win32";
const baseUrlFallback = fileSystemPathToUrl(process.cwd());

const isWindows$2 = process.platform === "win32";

const readFilePromisified = util.promisify(fs.readFile);

const {
  readFile
} = fs.promises;
const serveFile = async (source, {
  method = "GET",
  headers = {},
  canReadDirectory = false,
  cacheStrategy = "etag",
  contentTypeMap = jsenvContentTypeMap
} = {}) => {
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: 501
    };
  }

  const sourceUrl = assertAndNormalizeFileUrl(source);

  try {
    const cacheWithMtime = cacheStrategy === "mtime";
    const cacheWithETag = cacheStrategy === "etag";
    const cachedDisabled = cacheStrategy === "none";
    const sourceStat = await readFileSystemNodeStat(sourceUrl);

    if (sourceStat.isDirectory()) {
      if (canReadDirectory === false) {
        return {
          status: 403,
          statusText: "not allowed to read directory",
          headers: { ...(cachedDisabled ? {
              "cache-control": "no-store"
            } : {})
          }
        };
      }

      const directoryContentArray = await readDirectory(sourceUrl);
      const directoryContentJson = JSON.stringify(directoryContentArray);
      return {
        status: 200,
        headers: { ...(cachedDisabled ? {
            "cache-control": "no-store"
          } : {}),
          "content-type": "application/json",
          "content-length": directoryContentJson.length
        },
        body: directoryContentJson
      };
    } // not a file, give up


    if (!sourceStat.isFile()) {
      return {
        status: 404,
        headers: { ...(cachedDisabled ? {
            "cache-control": "no-store"
          } : {})
        }
      };
    }

    if (cacheWithETag) {
      const fileContentAsBuffer = await readFile(urlToFileSystemPath(sourceUrl));
      const fileContentEtag = bufferToEtag(fileContentAsBuffer);

      if ("if-none-match" in headers && headers["if-none-match"] === fileContentEtag) {
        return {
          status: 304,
          headers: { ...(cachedDisabled ? {
              "cache-control": "no-store"
            } : {})
          }
        };
      }

      return {
        status: 200,
        headers: { ...(cachedDisabled ? {
            "cache-control": "no-store"
          } : {}),
          "content-length": sourceStat.size,
          "content-type": urlToContentType(sourceUrl, contentTypeMap),
          "etag": fileContentEtag
        },
        body: fileContentAsBuffer
      };
    }

    if (cacheWithMtime && "if-modified-since" in headers) {
      let cachedModificationDate;

      try {
        cachedModificationDate = new Date(headers["if-modified-since"]);
      } catch (e) {
        return {
          status: 400,
          statusText: "if-modified-since header is not a valid date"
        };
      }

      const actualModificationDate = dateToSecondsPrecision(sourceStat.mtime);

      if (Number(cachedModificationDate) >= Number(actualModificationDate)) {
        return {
          status: 304
        };
      }
    }

    return {
      status: 200,
      headers: { ...(cachedDisabled ? {
          "cache-control": "no-store"
        } : {}),
        ...(cacheWithMtime ? {
          "last-modified": dateToUTCString(sourceStat.mtime)
        } : {}),
        "content-length": sourceStat.size,
        "content-type": urlToContentType(sourceUrl, contentTypeMap)
      },
      body: fs.createReadStream(urlToFileSystemPath(sourceUrl))
    };
  } catch (e) {
    return convertFileSystemErrorToResponseProperties(e);
  }
}; // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toUTCString

const dateToUTCString = date => date.toUTCString();

const dateToSecondsPrecision = date => {
  const dateWithSecondsPrecision = new Date(date);
  dateWithSecondsPrecision.setMilliseconds(0);
  return dateWithSecondsPrecision;
};

// eslint-disable-next-line import/no-unresolved
const nodeRequire = require;
const filenameContainsBackSlashes = __filename.indexOf("\\") > -1;
const url = filenameContainsBackSlashes ? `file:///${__filename.replace(/\\/g, "/")}` : `file://${__filename}`;

let beforeExitCallbackArray = [];
let uninstall;

const addCallback = callback => {
  if (beforeExitCallbackArray.length === 0) uninstall = install();
  beforeExitCallbackArray = [...beforeExitCallbackArray, callback];
  return () => {
    if (beforeExitCallbackArray.length === 0) return;
    beforeExitCallbackArray = beforeExitCallbackArray.filter(beforeExitCallback => beforeExitCallback !== callback);
    if (beforeExitCallbackArray.length === 0) uninstall();
  };
};

const install = () => {
  const onBeforeExit = () => {
    return beforeExitCallbackArray.reduce(async (previous, callback) => {
      await previous;
      return callback();
    }, Promise.resolve());
  };

  process.once("beforeExit", onBeforeExit);
  return () => {
    process.removeListener("beforeExit", onBeforeExit);
  };
};

const beforeExitSignal = {
  addCallback
};

const addCallback$1 = callback => {
  const triggerDeath = () => callback(); // SIGTERM http://man7.org/linux/man-pages/man7/signal.7.html


  process.once("SIGTERM", triggerDeath);
  return () => {
    process.removeListener("SIGTERM", triggerDeath);
  };
};

const deathSignal = {
  addCallback: addCallback$1
};

const addCallback$2 = (callback, {
  collectExceptions = false
} = {}) => {
  if (!collectExceptions) {
    const exitCallback = () => {
      callback();
    };

    process.on("exit", exitCallback);
    return () => {
      process.removeListener("exit", exitCallback);
    };
  }

  const {
    getExceptions,
    stop
  } = trackExceptions();

  const exitCallback = () => {
    process.removeListener("exit", exitCallback);
    stop();
    callback({
      exceptionArray: getExceptions().map(({
        exception,
        origin
      }) => {
        return {
          exception,
          origin
        };
      })
    });
  };

  process.on("exit", exitCallback);
  return () => {
    process.removeListener("exit", exitCallback);
  };
};

const trackExceptions = () => {
  let exceptionArray = [];

  const unhandledRejectionCallback = (unhandledRejection, promise) => {
    exceptionArray = [...exceptionArray, {
      origin: "unhandledRejection",
      exception: unhandledRejection,
      promise
    }];
  };

  const rejectionHandledCallback = promise => {
    exceptionArray = exceptionArray.filter(exceptionArray => exceptionArray.promise !== promise);
  };

  const uncaughtExceptionCallback = (uncaughtException, origin) => {
    // since node 12.4 https://nodejs.org/docs/latest-v12.x/api/process.html#process_event_uncaughtexception
    if (origin === "unhandledRejection") return;
    exceptionArray = [...exceptionArray, {
      origin: "uncaughtException",
      exception: uncaughtException
    }];
  };

  process.on("unhandledRejection", unhandledRejectionCallback);
  process.on("rejectionHandled", rejectionHandledCallback);
  process.on("uncaughtException", uncaughtExceptionCallback);
  return {
    getExceptions: () => exceptionArray,
    stop: () => {
      process.removeListener("unhandledRejection", unhandledRejectionCallback);
      process.removeListener("rejectionHandled", rejectionHandledCallback);
      process.removeListener("uncaughtException", uncaughtExceptionCallback);
    }
  };
};

const exitSignal = {
  addCallback: addCallback$2
};

const addCallback$3 = callback => {
  const triggerHangUpOrDeath = () => callback(); // SIGHUP http://man7.org/linux/man-pages/man7/signal.7.html


  process.once("SIGUP", triggerHangUpOrDeath);
  return () => {
    process.removeListener("SIGUP", triggerHangUpOrDeath);
  };
};

const hangupOrDeathSignal = {
  addCallback: addCallback$3
};

const addCallback$4 = callback => {
  // SIGINT is CTRL+C from keyboard
  // http://man7.org/linux/man-pages/man7/signal.7.html
  // may also be sent by vscode https://github.com/Microsoft/vscode-node-debug/issues/1#issuecomment-405185642
  process.once("SIGINT", callback);
  return () => {
    process.removeListener("SIGINT", callback);
  };
};

const interruptSignal = {
  addCallback: addCallback$4
};

// usefull to ensure a given server is closed when process stops for instance

const addCallback$5 = callback => {
  return eventRace({
    beforeExit: {
      register: beforeExitSignal.addCallback,
      callback: () => callback("beforeExit")
    },
    hangupOrDeath: {
      register: hangupOrDeathSignal.addCallback,
      callback: () => callback("hangupOrDeath")
    },
    death: {
      register: deathSignal.addCallback,
      callback: () => callback("death")
    },
    exit: {
      register: exitSignal.addCallback,
      callback: () => callback("exit")
    }
  });
};

const eventRace = eventMap => {
  const unregisterMap = {};

  const unregisterAll = reason => {
    return Object.keys(unregisterMap).map(name => unregisterMap[name](reason));
  };

  Object.keys(eventMap).forEach(name => {
    const {
      register,
      callback
    } = eventMap[name];
    unregisterMap[name] = register((...args) => {
      unregisterAll();
      callback(...args);
    });
  });
  return unregisterAll;
};

const teardownSignal = {
  addCallback: addCallback$5
};

const firstOperationMatching$1 = ({
  array,
  start,
  predicate
}) => {
  if (typeof array !== "object") throw new TypeError(createArrayErrorMessage({
    array
  }));
  if (typeof start !== "function") throw new TypeError(createStartErrorMessage({
    start
  }));
  if (typeof predicate !== "function") throw new TypeError(createPredicateErrorMessage({
    predicate
  }));
  return new Promise((resolve, reject) => {
    const visit = index => {
      if (index >= array.length) {
        return resolve();
      }

      const input = array[index];
      const returnValue = start(input);
      return Promise.resolve(returnValue).then(output => {
        if (predicate(output)) {
          return resolve(output);
        }

        return visit(index + 1);
      }, reject);
    };

    visit(0);
  });
};

const createArrayErrorMessage = ({
  array
}) => `array must be an object.
array: ${array}`;

const createStartErrorMessage = ({
  start
}) => `start must be a function.
start: ${start}`;

const createPredicateErrorMessage = ({
  predicate
}) => `predicate must be a function.
predicate: ${predicate}`;

/*
why unadvised ?
- First because you should not do anything when a process uncaughtException
or unhandled rejection happens.
You cannot assume assume or trust the state of your process so you're
likely going to throw an other error trying to handle the first one.
- Second because the error stack trace will be modified making it harder
to reach back what cause the error

Instead you should monitor your process with an other one
and when the monitored process die, here you can do what you want
like analysing logs to find what cause process to die, ping a log server, ...
*/
let recoverCallbackArray = [];
let uninstall$1;

const addCallback$6 = callback => {
  if (recoverCallbackArray.length === 0) uninstall$1 = install$1();
  recoverCallbackArray = [...recoverCallbackArray, callback];
  return () => {
    if (recoverCallbackArray.length === 0) return;
    recoverCallbackArray = recoverCallbackArray.filter(recoverCallback => recoverCallback !== callback);
    if (recoverCallbackArray.length === 0) uninstall$1();
  };
};

const install$1 = () => {
  const onUncaughtException = error => triggerUncaughtException(error);

  const onUnhandledRejection = (value, promise) => triggerUnhandledRejection(value, promise);

  const onRejectionHandled = promise => recoverExceptionMatching(exception => exception.promise === promise);

  process.on("unhandledRejection", onUnhandledRejection);
  process.on("rejectionHandled", onRejectionHandled);
  process.on("uncaughtException", onUncaughtException);
  return () => {
    process.removeListener("unhandledRejection", onUnhandledRejection);
    process.removeListener("rejectionHandled", onRejectionHandled);
    process.removeListener("uncaughtException", onRejectionHandled);
  };
};

const triggerUncaughtException = error => crash({
  type: "uncaughtException",
  value: error
});

const triggerUnhandledRejection = (value, promise) => crash({
  type: "unhandledRejection",
  value,
  promise
});

let isCrashing = false;
let crashReason;
let resolveRecovering;

const crash = async reason => {
  if (isCrashing) {
    console.log(`cannot recover due to ${crashReason.type} during recover`);
    console.error(crashReason.value);
    resolveRecovering(false);
    return;
  }

  console.log(`process starts crashing due to ${crashReason.type}`);
  console.log(`trying to recover`);
  isCrashing = true;
  crashReason = reason;
  const externalRecoverPromise = new Promise(resolve => {
    resolveRecovering = resolve;
  });
  const callbackRecoverPromise = firstOperationMatching$1({
    array: recoverCallbackArray,
    start: recoverCallback => recoverCallback(reason),
    predicate: recovered => typeof recovered === "boolean"
  });
  const recoverPromise = Promise.race([externalRecoverPromise, callbackRecoverPromise]);

  try {
    const recovered = await recoverPromise;
    if (recovered) return;
  } catch (error) {
    console.error(`cannot recover due to internal recover error`);
    console.error(error);
  }

  crashReason = undefined; // uninstall() prevent catching of the next throw
  // else the following would create an infinite loop
  // process.on('uncaughtException', function() {
  //     setTimeout(function() {
  //         throw 'yo';
  //     });
  // });

  uninstall$1();
  throw reason.value; // this mess up the stack trace :'(
};

const recoverExceptionMatching = predicate => {
  if (isCrashing && predicate(crashReason)) {
    resolveRecovering(true);
  }
};

const unadvisedCrashSignal = {
  addCallback: addCallback$6
};

const memoizeOnce$1 = compute => {
  let locked = false;
  let lockValue;

  const memoized = (...args) => {
    if (locked) return lockValue; // if compute is recursive wait for it to be fully done before storing the lockValue
    // so set locked later

    lockValue = compute(...args);
    locked = true;
    return lockValue;
  };

  memoized.deleteCache = () => {
    const value = lockValue;
    locked = false;
    lockValue = undefined;
    return value;
  };

  return memoized;
};

const urlToOrigin = url => {
  return new URL(url).origin;
};

const trackConnections = nodeServer => {
  const connections = new Set();

  const connectionListener = connection => {
    connection.on("close", () => {
      connections.delete(connection);
    });
    connections.add(connection);
  };

  nodeServer.on("connection", connectionListener);

  const stop = reason => {
    nodeServer.removeListener("connection", connectionListener); // should we do this async ?

    connections.forEach(connection => {
      connection.destroy(reason);
    });
  };

  return {
    stop
  };
};

const trackClients = nodeServer => {
  const clients = new Set();

  const clientListener = (nodeRequest, nodeResponse) => {
    const client = {
      nodeRequest,
      nodeResponse
    };
    clients.add(client);
    nodeResponse.on("finish", () => {
      clients.delete(client);
    });
  };

  nodeServer.on("request", clientListener);

  const stop = ({
    status,
    reason
  }) => {
    nodeServer.removeListener("request", clientListener);
    return Promise.all(Array.from(clients).map(({
      nodeResponse
    }) => {
      if (nodeResponse.headersSent === false) {
        nodeResponse.writeHead(status, reason);
      }

      return new Promise(resolve => {
        if (nodeResponse.finished === false) {
          nodeResponse.on("finish", resolve);
          nodeResponse.on("error", resolve);
          nodeResponse.destroy(reason);
        } else {
          resolve();
        }
      });
    }));
  };

  return {
    stop
  };
};

const trackRequestHandlers = nodeServer => {
  const requestHandlers = [];

  const add = handler => {
    requestHandlers.push(handler);
    nodeServer.on("request", handler);
    return () => {
      nodeServer.removeListener("request", handler);
    };
  };

  const stop = () => {
    requestHandlers.forEach(requestHandler => {
      nodeServer.removeListener("request", requestHandler);
    });
    requestHandlers.length = 0;
  };

  return {
    add,
    stop
  };
};

const nodeStreamToObservable = nodeStream => {
  return createObservable({
    subscribe: ({
      next,
      error,
      complete
    }) => {
      // should we do nodeStream.resume() in case the stream was paused
      nodeStream.on("data", next);
      nodeStream.once("error", error);
      nodeStream.once("end", complete);

      const unsubscribe = () => {
        nodeStream.removeListener("data", next);
        nodeStream.removeListener("error", error);
        nodeStream.removeListener("end", complete);

        if (nodeStreamIsNodeRequest(nodeStream)) {
          nodeStream.abort();
        } else {
          nodeStream.destroy();
        }
      };

      if (nodeStreamIsNodeRequest(nodeStream)) {
        nodeStream.once("abort", unsubscribe);
      }

      return {
        unsubscribe
      };
    }
  });
};

const nodeStreamIsNodeRequest = nodeStream => "abort" in nodeStream && "flushHeaders" in nodeStream;

const normalizeHeaderName = headerName => {
  headerName = String(headerName);

  if (/[^a-z0-9\-#$%&'*+.\^_`|~]/i.test(headerName)) {
    throw new TypeError("Invalid character in header field name");
  }

  return headerName.toLowerCase();
};

const normalizeHeaderValue = headerValue => {
  return String(headerValue);
};

/*
https://developer.mozilla.org/en-US/docs/Web/API/Headers
https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
*/
const headersFromObject = headersObject => {
  const headers = {};
  Object.keys(headersObject).forEach(headerName => {
    headers[normalizeHeaderName(headerName)] = normalizeHeaderValue(headersObject[headerName]);
  });
  return headers;
};

const nodeRequestToRequest = (nodeRequest, origin) => {
  const ressource = nodeRequest.url;
  const {
    method
  } = nodeRequest;
  const headers = headersFromObject(nodeRequest.headers);
  const body = method === "POST" || method === "PUT" || method === "PATCH" ? nodeStreamToObservable(nodeRequest) : undefined;
  return Object.freeze({
    origin,
    ressource,
    method,
    headers,
    body
  });
};

const valueToObservable = value => {
  return createObservable({
    subscribe: ({
      next,
      complete
    }) => {
      next(value);
      complete();
      return {
        unsubscribe: () => {}
      };
    }
  });
};

const populateNodeResponse = (nodeResponse, {
  status,
  statusText,
  headers,
  body,
  bodyEncoding
}, {
  ignoreBody
}) => {
  const nodeHeaders = headersToNodeHeaders(headers); // nodejs strange signature for writeHead force this
  // https://nodejs.org/api/http.html#http_response_writehead_statuscode_statusmessage_headers

  if (statusText === undefined) {
    nodeResponse.writeHead(status, nodeHeaders);
  } else {
    nodeResponse.writeHead(status, statusText, nodeHeaders);
  }

  if (ignoreBody) {
    nodeResponse.end();
    return;
  }

  if (bodyEncoding) {
    nodeResponse.setEncoding(bodyEncoding);
  }

  const observable = bodyToObservable(body);
  const subscription = subscribe(observable, {
    next: data => {
      nodeResponse.write(data);
    },
    error: value => {
      nodeResponse.emit("error", value);
    },
    complete: () => {
      nodeResponse.end();
    }
  });
  nodeResponse.once("close", () => {
    // close body in case nodeResponse is prematurely closed
    // while body is writing
    // it may happen in case of server sent event
    // where body is kept open to write to client
    // and the browser is reloaded or closed for instance
    subscription.unsubscribe();
  });
};
const mapping = {// "content-type": "Content-Type",
  // "last-modified": "Last-Modified",
};

const headersToNodeHeaders = headers => {
  const nodeHeaders = {};
  Object.keys(headers).forEach(name => {
    const nodeHeaderName = name in mapping ? mapping[name] : name;
    nodeHeaders[nodeHeaderName] = headers[name];
  });
  return nodeHeaders;
};

const bodyToObservable = body => {
  if (isObservable(body)) return body;
  if (isNodeStream(body)) return nodeStreamToObservable(body);
  return valueToObservable(body);
};

const isNodeStream = value => {
  if (value === undefined) return false;
  if (value instanceof stream.Stream) return true;
  if (value instanceof stream.Writable) return true;
  if (value instanceof stream.Readable) return true;
  return false;
};

// https://github.com/Marak/colors.js/blob/b63ef88e521b42920a9e908848de340b31e68c9d/lib/styles.js#L29
const close = "\x1b[0m";
const red = "\x1b[31m";
const green = "\x1b[32m";
const yellow = "\x1b[33m"; // const blue = "\x1b[34m"

const magenta = "\x1b[35m";
const cyan = "\x1b[36m"; // const white = "\x1b[37m"

const colorizeResponseStatus = status => {
  const statusType = statusToType(status);
  if (statusType === "information") return `${cyan}${status}${close}`;
  if (statusType === "success") return `${green}${status}${close}`;
  if (statusType === "redirection") return `${magenta}${status}${close}`;
  if (statusType === "client-error") return `${yellow}${status}${close}`;
  if (statusType === "server-error") return `${red}${status}${close}`;
  return status;
}; // https://developer.mozilla.org/en-US/docs/Web/HTTP/Status

const statusToType = status => {
  if (statusIsInformation(status)) return "information";
  if (statusIsSuccess(status)) return "success";
  if (statusIsRedirection(status)) return "redirection";
  if (statusIsClientError(status)) return "client-error";
  if (statusIsServerError(status)) return "server-error";
  return "unknown";
};

const statusIsInformation = status => status >= 100 && status < 200;

const statusIsSuccess = status => status >= 200 && status < 300;

const statusIsRedirection = status => status >= 300 && status < 400;

const statusIsClientError = status => status >= 400 && status < 500;

const statusIsServerError = status => status >= 500 && status < 600;

const originAsString = ({
  protocol,
  ip,
  port
}) => {
  const url = new url$1.URL("https://127.0.0.1:80");
  url.protocol = protocol;
  url.hostname = ip;
  url.port = port;
  return url.origin;
};

const createReason = reasonString => {
  return {
    toString: () => reasonString
  };
};

const STOP_REASON_INTERNAL_ERROR = createReason("internal error");
const STOP_REASON_PROCESS_SIGINT = createReason("process sigint");
const STOP_REASON_PROCESS_BEFORE_EXIT = createReason("process before exit");
const STOP_REASON_PROCESS_HANGUP_OR_DEATH = createReason("process hangup or death");
const STOP_REASON_PROCESS_DEATH = createReason("process death");
const STOP_REASON_PROCESS_EXIT = createReason("process exit");
const STOP_REASON_NOT_SPECIFIED = createReason("not specified");

const require$1 = module$1.createRequire(url);

const killPort = require$1("kill-port");

const STATUS_TEXT_INTERNAL_ERROR = "internal error";
const startServer = async ({
  cancellationToken = createCancellationToken(),
  logLevel,
  logStart = true,
  logStop = true,
  protocol = "http",
  ip = "127.0.0.1",
  port = 0,
  // assign a random available port
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
  internalErrorToResponseProperties = error => {
    const body = error ? JSON.stringify({
      code: error.code || "UNKNOWN_ERROR",
      ...(sendInternalErrorStack ? {
        stack: error.stack
      } : {})
    }) : JSON.stringify({
      code: "VALUE_THROWED",
      value: error
    });
    return {
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      },
      body
    };
  },
  startedCallback = () => {},
  stoppedCallback = () => {}
} = {}) => {
  if (port === 0 && forcePort) throw new Error(`no need to pass forcePort when port is 0`);
  if (protocol !== "http" && protocol !== "https") throw new Error(`protocol must be http or https, got ${protocol}`); // https://github.com/nodejs/node/issues/14900

  if (ip === "0.0.0.0" && process.platform === "win32") throw new Error(`listening ${ip} not available on window`);
  const logger = createLogger({
    logLevel
  });

  if (forcePort) {
    await createOperation({
      cancellationToken,
      start: () => killPort(port)
    });
  }

  const {
    nodeServer,
    agent
  } = getNodeServerAndAgent({
    protocol,
    privateKey,
    certificate
  }); // https://nodejs.org/api/net.html#net_server_unref

  if (!keepProcessAlive) {
    nodeServer.unref();
  }

  let status = "starting";
  const {
    registerCleanupCallback,
    cleanup
  } = createTracker();
  const connectionTracker = trackConnections(nodeServer); // opened connection must be shutdown before the close event is emitted

  registerCleanupCallback(connectionTracker.stop);
  const clientTracker = trackClients(nodeServer);
  registerCleanupCallback(reason => {
    let responseStatus;

    if (reason === STOP_REASON_INTERNAL_ERROR) {
      responseStatus = 500; // reason = 'shutdown because error'
    } else {
      responseStatus = 503; // reason = 'unavailable because closing'
    }

    clientTracker.stop({
      status: responseStatus,
      reason
    });
  });
  const requestHandlerTracker = trackRequestHandlers(nodeServer); // ensure we don't try to handle request while server is closing

  registerCleanupCallback(requestHandlerTracker.stop);
  let stoppedResolve;
  const stoppedPromise = new Promise(resolve => {
    stoppedResolve = resolve;
  });
  const stop = memoizeOnce$1(async (reason = STOP_REASON_NOT_SPECIFIED) => {
    status = "closing";

    if (logStop) {
      logger.info(`server stopped because ${reason}`);
    }

    await cleanup(reason);
    await stopListening(nodeServer);
    status = "stopped";
    stoppedCallback({
      reason
    });
    stoppedResolve(reason);
  });
  const startOperation = createStoppableOperation({
    cancellationToken,
    start: () => listen({
      cancellationToken,
      server: nodeServer,
      port,
      ip
    }),
    stop: (_, reason) => stop(reason)
  });

  if (stopOnCrash) {
    const unregister = unadvisedCrashSignal.addCallback(reason => {
      stop(reason.value);
    });
    registerCleanupCallback(unregister);
  }

  if (stopOnInternalError) {
    const unregister = requestHandlerTracker.add((nodeRequest, nodeResponse) => {
      if (nodeResponse.statusCode === 500 && nodeResponse.statusMessage === STATUS_TEXT_INTERNAL_ERROR) {
        stop(STOP_REASON_INTERNAL_ERROR);
      }
    });
    registerCleanupCallback(unregister);
  }

  if (stopOnExit) {
    const unregister = teardownSignal.addCallback(tearDownReason => {
      stop({
        beforeExit: STOP_REASON_PROCESS_BEFORE_EXIT,
        hangupOrDeath: STOP_REASON_PROCESS_HANGUP_OR_DEATH,
        death: STOP_REASON_PROCESS_DEATH,
        exit: STOP_REASON_PROCESS_EXIT
      }[tearDownReason]);
    });
    registerCleanupCallback(unregister);
  }

  if (stopOnSIGINT) {
    const unregister = interruptSignal.addCallback(() => {
      stop(STOP_REASON_PROCESS_SIGINT);
    });
    registerCleanupCallback(unregister);
  }

  port = await startOperation;
  status = "opened";
  const origin = originAsString({
    protocol,
    ip,
    port
  });

  if (logStart) {
    logger.info(`server started at ${origin}`);
  }

  startedCallback({
    origin
  }); // nodeServer.on("upgrade", (request, socket, head) => {
  //   // when being requested using a websocket
  //   // we could also answr to the request ?
  //   // socket.end([data][, encoding])
  //   console.log("upgrade", { head, request })
  //   console.log("socket", { connecting: socket.connecting, destroyed: socket.destroyed })
  // })

  requestHandlerTracker.add(async (nodeRequest, nodeResponse) => {
    const {
      request,
      response,
      error
    } = await generateResponseDescription({
      nodeRequest,
      origin
    });

    if (request.method !== "HEAD" && response.headers["content-length"] > 0 && response.body === "") {
      logger.error(createContentLengthMismatchError(`content-length header is ${response.headers["content-length"]} but body is empty`));
    }

    logger.info(`${request.method} ${request.origin}${request.ressource}`);

    if (error) {
      logger.error(error);
    }

    logger.info(`${colorizeResponseStatus(response.status)} ${response.statusText}`);
    populateNodeResponse(nodeResponse, response, {
      ignoreBody: request.method === "HEAD"
    });
  });
  const corsEnabled = accessControlAllowRequestOrigin || accessControlAllowedOrigins.length; // here we check access control options to throw or warn if we find strange values

  const generateResponseDescription = async ({
    nodeRequest,
    origin
  }) => {
    const request = nodeRequestToRequest(nodeRequest, origin);
    nodeRequest.on("error", error => {
      logger.error("error on", request.ressource, error);
    });

    const responsePropertiesToResponse = ({
      status = 501,
      statusText = statusToStatusText(status),
      headers = {},
      body = "",
      bodyEncoding
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
          accessControlMaxAge
        });
        return {
          status,
          statusText,
          headers: composeResponseHeaders(headers, accessControlHeaders),
          body,
          bodyEncoding
        };
      }

      return {
        status,
        statusText,
        headers,
        body,
        bodyEncoding
      };
    };

    try {
      if (corsEnabled && request.method === "OPTIONS") {
        return {
          request,
          response: responsePropertiesToResponse({
            status: 200,
            headers: {
              "content-length": 0
            }
          })
        };
      }

      const responseProperties = await requestToResponse(request);
      return {
        request,
        response: responsePropertiesToResponse(responseProperties || {})
      };
    } catch (error) {
      return {
        request,
        response: composeResponse(responsePropertiesToResponse({
          status: 500,
          statusText: STATUS_TEXT_INTERNAL_ERROR,
          headers: {
            // ensure error are not cached
            "cache-control": "no-store",
            "content-type": "text/plain"
          }
        }), internalErrorToResponseProperties(error)),
        error
      };
    }
  };

  return {
    getStatus: () => status,
    origin,
    nodeServer,
    // TODO: remove agent
    agent,
    stop,
    stoppedPromise
  };
};

const createTracker = () => {
  const callbackArray = [];

  const registerCleanupCallback = callback => {
    if (typeof callback !== "function") throw new TypeError(`callback must be a function
callback: ${callback}`);
    callbackArray.push(callback);
  };

  const cleanup = async reason => {
    const localCallbackArray = callbackArray.slice();
    await Promise.all(localCallbackArray.map(callback => callback(reason)));
  };

  return {
    registerCleanupCallback,
    cleanup
  };
};

const statusToStatusText = status => http.STATUS_CODES[status] || "not specified";

const getNodeServerAndAgent = ({
  protocol,
  privateKey,
  certificate
}) => {
  if (protocol === "http") {
    return {
      nodeServer: http.createServer(),
      agent: global.Agent
    };
  }

  if (protocol === "https") {
    if (!privateKey) {
      throw new Error(`missing privateKey for https server`);
    }

    if (!certificate) {
      throw new Error(`missing certificate for https server`);
    }

    if (privateKey !== jsenvPrivateKey && certificate === jsenvCertificate) {
      throw new Error(`you passed a privateKey without certificate`);
    }

    if (certificate !== jsenvCertificate && privateKey === jsenvPrivateKey) {
      throw new Error(`you passed a certificate without privateKey`);
    }

    return {
      nodeServer: https.createServer({
        key: privateKey,
        cert: certificate
      }),
      agent: new https.Agent({
        rejectUnauthorized: false // allow self signed certificate

      })
    };
  }

  throw new Error(`unsupported protocol ${protocol}`);
};

const createContentLengthMismatchError = message => {
  const error = new Error(message);
  error.code = "CONTENT_LENGTH_MISMATCH";
  error.name = error.code;
  return error;
}; // https://www.w3.org/TR/cors/
// https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS


const generateAccessControlHeaders = ({
  request: {
    headers
  },
  accessControlAllowedOrigins,
  accessControlAllowRequestOrigin,
  accessControlAllowedMethods,
  accessControlAllowRequestMethod,
  accessControlAllowedHeaders,
  accessControlAllowRequestHeaders,
  accessControlAllowCredentials,
  // by default OPTIONS request can be cache for a long time, it's not going to change soon ?
  // we could put a lot here, see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
  accessControlMaxAge = 600
} = {}) => {
  const vary = [];
  const allowedOriginArray = [...accessControlAllowedOrigins];

  if (accessControlAllowRequestOrigin) {
    if ("origin" in headers && headers.origin !== "null") {
      allowedOriginArray.push(headers.origin);
      vary.push("origin");
    } else if ("referer" in headers) {
      allowedOriginArray.push(urlToOrigin(headers.referer));
      vary.push("referer");
    } else {
      allowedOriginArray.push("*");
    }
  }

  const allowedMethodArray = [...accessControlAllowedMethods];

  if (accessControlAllowRequestMethod && "access-control-request-method" in headers) {
    const requestMethodName = headers["access-control-request-method"];

    if (!allowedMethodArray.includes(requestMethodName)) {
      allowedMethodArray.push(requestMethodName);
      vary.push("access-control-request-method");
    }
  }

  const allowedHeaderArray = [...accessControlAllowedHeaders];

  if (accessControlAllowRequestHeaders && "access-control-request-headers" in headers) {
    const requestHeaderNameArray = headers["access-control-request-headers"].split(", ");
    requestHeaderNameArray.forEach(headerName => {
      const headerNameLowerCase = headerName.toLowerCase();

      if (!allowedHeaderArray.includes(headerNameLowerCase)) {
        allowedHeaderArray.push(headerNameLowerCase);

        if (!vary.includes("access-control-request-headers")) {
          vary.push("access-control-request-headers");
        }
      }
    });
  }

  return {
    "access-control-allow-origin": allowedOriginArray.join(", "),
    "access-control-allow-methods": allowedMethodArray.join(", "),
    "access-control-allow-headers": allowedHeaderArray.join(", "),
    ...(accessControlAllowCredentials ? {
      "access-control-allow-credentials": true
    } : {}),
    "access-control-max-age": accessControlMaxAge,
    ...(vary.length ? {
      vary: vary.join(", ")
    } : {})
  };
};

exports.STOP_REASON_INTERNAL_ERROR = STOP_REASON_INTERNAL_ERROR;
exports.STOP_REASON_NOT_SPECIFIED = STOP_REASON_NOT_SPECIFIED;
exports.STOP_REASON_PROCESS_BEFORE_EXIT = STOP_REASON_PROCESS_BEFORE_EXIT;
exports.STOP_REASON_PROCESS_DEATH = STOP_REASON_PROCESS_DEATH;
exports.STOP_REASON_PROCESS_EXIT = STOP_REASON_PROCESS_EXIT;
exports.STOP_REASON_PROCESS_HANGUP_OR_DEATH = STOP_REASON_PROCESS_HANGUP_OR_DEATH;
exports.STOP_REASON_PROCESS_SIGINT = STOP_REASON_PROCESS_SIGINT;
exports.acceptsContentType = acceptsContentType;
exports.composeResponse = composeResponse;
exports.convertFileSystemErrorToResponseProperties = convertFileSystemErrorToResponseProperties;
exports.createSSERoom = createSSERoom;
exports.findFreePort = findFreePort;
exports.firstService = firstService;
exports.jsenvAccessControlAllowedHeaders = jsenvAccessControlAllowedHeaders;
exports.jsenvAccessControlAllowedMethods = jsenvAccessControlAllowedMethods;
exports.jsenvCertificate = jsenvCertificate;
exports.jsenvPrivateKey = jsenvPrivateKey;
exports.jsenvPublicKey = jsenvPublicKey;
exports.serveFile = serveFile;
exports.startServer = startServer;
exports.urlToContentType = urlToContentType;
exports.urlToSearchParamValue = urlToSearchParamValue;
//# sourceMappingURL=main.js.map
