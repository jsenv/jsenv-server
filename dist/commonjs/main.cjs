'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var module$1 = require('module');
var https = require('https');
var fs = require('fs');
var url$1 = require('url');
var crypto = require('crypto');
var path = require('path');
var util = require('util');
var perf_hooks = require('perf_hooks');
var net = require('net');
var http = require('http');
var stream = require('stream');
var os = require('os');

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () {
            return e[k];
          }
        });
      }
    });
  }
  n['default'] = e;
  return Object.freeze(n);
}

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
    const propertyExistInCurrent = (key in current);
    if (!propertyExistInCurrent) return previous[key];
    const propertyExistInPrevious = (key in previous);
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
    const propertyExistInCurrent = (key in current);
    if (!propertyExistInCurrent) return previous[key];
    const propertyExistInPrevious = (key in previous);
    if (!propertyExistInPrevious) return current[key];
    const propertyHasComposer = (key in compositionMapping);
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
  // https://www.w3.org/TR/server-timing/
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing
  "server-timing": composeHeaderValues,
  // 'content-type', // https://github.com/ninenines/cowboy/issues/1230
  "vary": composeHeaderValues
};
const composeResponseHeaders = compositionMappingToCompose(headerCompositionMapping);

const responseCompositionMapping = {
  status: (prevStatus, status) => status,
  statusText: (prevStatusText, statusText) => statusText,
  headers: composeResponseHeaders,
  body: (prevBody, body) => body,
  bodyEncoding: (prevEncoding, encoding) => encoding,
  timing: (prevTiming, timing) => {
    return { ...prevTiming,
      ...timing
    };
  }
};
const composeResponse = compositionMappingToComposeStrict(responseCompositionMapping);

const convertFileSystemErrorToResponseProperties = error => {
  // https://iojs.org/api/errors.html#errors_eacces_permission_denied
  if (isErrorWithCode(error, "EACCES")) {
    return {
      status: 403,
      statusText: `EACCES: No permission to read file at ${error.path}`
    };
  }

  if (isErrorWithCode(error, "EPERM")) {
    return {
      status: 403,
      statusText: `EPERM: No permission to read file at ${error.path}`
    };
  }

  if (isErrorWithCode(error, "ENOENT")) {
    return {
      status: 404,
      statusText: `ENOENT: File not found at ${error.path}`
    };
  } // file access may be temporarily blocked
  // (by an antivirus scanning it because recently modified for instance)


  if (isErrorWithCode(error, "EBUSY")) {
    return {
      status: 503,
      statusText: `EBUSY: File is busy ${error.path}`,
      headers: {
        "retry-after": 0.01 // retry in 10ms

      }
    };
  } // emfile means there is too many files currently opened


  if (isErrorWithCode(error, "EMFILE")) {
    return {
      status: 503,
      statusText: "EMFILE: too many file opened",
      headers: {
        "retry-after": 0.1 // retry in 100ms

      }
    };
  }

  if (isErrorWithCode(error, "EISDIR")) {
    return {
      status: 500,
      statusText: `EISDIR: Unexpected directory operation at ${error.path}`
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
  return subscription || {
    unsubscribe: () => {}
  };
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
  maxConnectionAllowed = 100,
  // max 100 users accepted
  computeEventId = (event, lastEventId) => lastEventId + 1,
  welcomeEvent = false,
  welcomeEventPublic = false
} = {}) => {
  const logger = createLogger({
    logLevel
  });
  const connections = new Set();
  const eventHistory = createEventHistory(historyLength); // what about previousEventId that keeps growing ?
  // we could add some limit
  // one limit could be that an event older than 24h is deleted

  let previousEventId = 0;
  let state = "closed";
  let interval;

  const eventsSince = id => {
    const events = eventHistory.since(id);

    if (welcomeEvent && !welcomeEventPublic) {
      return events.filter(event => event.type !== "welcome");
    }

    return events;
  };

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

    const firstEvent = {
      retry: retryDuration,
      type: welcomeEvent ? "welcome" : "comment",
      data: new Date().toLocaleTimeString()
    };

    if (welcomeEvent) {
      firstEvent.id = computeEventId(firstEvent, previousEventId);
      previousEventId = firstEvent.id;
      eventHistory.add(firstEvent);
    }

    const events = [// send events which occured between lastKnownId & now
    ...(lastKnownId === undefined ? [] : eventsSince(lastKnownId)), firstEvent];
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
        "cache-control": "no-store",
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

      if (typeof event.id === "undefined") {
        event.id = computeEventId(event, previousEventId);
      }

      previousEventId = event.id;
      eventHistory.add(event);
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
    eventHistory.reset();
    state = "stopped";
  };

  return {
    start,
    stop,
    connect,
    eventsSince,
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

const createEventHistory = limit => {
  const events = [];

  const add = data => {
    events.push(data);

    if (events.length >= limit) {
      events.shift();
    }
  };

  const since = id => {
    const index = events.findIndex(event => String(event.id) === id);
    return index === -1 ? [] : events.slice(index + 1);
  };

  const reset = () => {
    events.length = 0;
  };

  return {
    add,
    since,
    reset
  };
};

/* global require, __filename */
const nodeRequire = require;
const filenameContainsBackSlashes = __filename.indexOf("\\") > -1;
const url = filenameContainsBackSlashes ? `file:///${__filename.replace(/\\/g, "/")}` : `file://${__filename}`;

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

  const visit = async index => {
    if (index >= array.length) {
      return undefined;
    }

    const input = array[index];
    const output = await start(input);

    if (predicate(output)) {
      return output;
    }

    return visit(index + 1);
  };

  return visit(0);
};

const createCancelError = reason => {
  const cancelError = new Error(`canceled because ${reason}`);
  cancelError.name = "CANCEL_ERROR";
  cancelError.reason = reason;
  return cancelError;
};
const isCancelError = value => {
  return value && typeof value === "object" && value.name === "CANCEL_ERROR";
};

const composeCancellationToken = (...tokens) => {
  const register = callback => {
    if (typeof callback !== "function") {
      throw new Error(`callback must be a function, got ${callback}`);
    }

    const registrationArray = [];

    const visit = i => {
      const token = tokens[i];
      const registration = token.register(callback);
      registrationArray.push(registration);
    };

    let i = 0;

    while (i < tokens.length) {
      visit(i++);
    }

    const compositeRegistration = {
      callback,
      unregister: () => {
        registrationArray.forEach(registration => registration.unregister());
        registrationArray.length = 0;
      }
    };
    return compositeRegistration;
  };

  let requested = false;
  let cancelError;
  const internalRegistration = register(parentCancelError => {
    requested = true;
    cancelError = parentCancelError;
    internalRegistration.unregister();
  });

  const throwIfRequested = () => {
    if (requested) {
      throw cancelError;
    }
  };

  return {
    register,

    get cancellationRequested() {
      return requested;
    },

    throwIfRequested
  };
};

const arrayWithout = (array, item) => {
  const arrayWithoutItem = [];
  let i = 0;

  while (i < array.length) {
    const value = array[i];
    i++;

    if (value === item) {
      continue;
    }

    arrayWithoutItem.push(value);
  }

  return arrayWithoutItem;
};

// https://github.com/tc39/proposal-cancellation/tree/master/stage0
const createCancellationSource = () => {
  let requested = false;
  let cancelError;
  let registrationArray = [];

  const cancel = reason => {
    if (requested) return;
    requested = true;
    cancelError = createCancelError(reason);
    const registrationArrayCopy = registrationArray.slice();
    registrationArray.length = 0;
    registrationArrayCopy.forEach(registration => {
      registration.callback(cancelError); // const removedDuringCall = registrationArray.indexOf(registration) === -1
    });
  };

  const register = callback => {
    if (typeof callback !== "function") {
      throw new Error(`callback must be a function, got ${callback}`);
    }

    const existingRegistration = registrationArray.find(registration => {
      return registration.callback === callback;
    }); // don't register twice

    if (existingRegistration) {
      return existingRegistration;
    }

    const registration = {
      callback,
      unregister: () => {
        registrationArray = arrayWithout(registrationArray, registration);
      }
    };
    registrationArray = [registration, ...registrationArray];
    return registration;
  };

  const throwIfRequested = () => {
    if (requested) {
      throw cancelError;
    }
  };

  return {
    token: {
      register,

      get cancellationRequested() {
        return requested;
      },

      throwIfRequested
    },
    cancel
  };
};

const addCallback = callback => {
  const triggerHangUpOrDeath = () => callback(); // SIGHUP http://man7.org/linux/man-pages/man7/signal.7.html


  process.once("SIGUP", triggerHangUpOrDeath);
  return () => {
    process.removeListener("SIGUP", triggerHangUpOrDeath);
  };
};

const SIGUPSignal = {
  addCallback
};

const addCallback$1 = callback => {
  // SIGINT is CTRL+C from keyboard also refered as keyboard interruption
  // http://man7.org/linux/man-pages/man7/signal.7.html
  // may also be sent by vscode https://github.com/Microsoft/vscode-node-debug/issues/1#issuecomment-405185642
  process.once("SIGINT", callback);
  return () => {
    process.removeListener("SIGINT", callback);
  };
};

const SIGINTSignal = {
  addCallback: addCallback$1
};

const addCallback$2 = callback => {
  if (process.platform === "win32") {
    console.warn(`SIGTERM is not supported on windows`);
    return () => {};
  }

  const triggerTermination = () => callback(); // SIGTERM http://man7.org/linux/man-pages/man7/signal.7.html


  process.once("SIGTERM", triggerTermination);
  return () => {
    process.removeListener("SIGTERM", triggerTermination);
  };
};

const SIGTERMSignal = {
  addCallback: addCallback$2
};

let beforeExitCallbackArray = [];
let uninstall;

const addCallback$3 = callback => {
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
  addCallback: addCallback$3
};

const addCallback$4 = (callback, {
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
  addCallback: addCallback$4
};

const addCallback$5 = callback => {
  return eventRace({
    SIGHUP: {
      register: SIGUPSignal.addCallback,
      callback: () => callback("SIGHUP")
    },
    SIGINT: {
      register: SIGINTSignal.addCallback,
      callback: () => callback("SIGINT")
    },
    ...(process.platform === "win32" ? {} : {
      SIGTERM: {
        register: SIGTERMSignal.addCallback,
        callback: () => callback("SIGTERM")
      }
    }),
    beforeExit: {
      register: beforeExitSignal.addCallback,
      callback: () => callback("beforeExit")
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

const wrapFunctionToCatchCancellation = asyncFunction => async (...args) => {
  try {
    const value = await asyncFunction(...args);
    return value;
  } catch (error) {
    if (isCancelError(error)) {
      // it means consume of the function will resolve with a cancelError
      // but when you cancel it means you're not interested in the result anymore
      // thanks to this it avoid unhandledRejection
      return error;
    }

    throw error;
  }
};

const wrapFunctionToConsiderUnhandledRejectionsAsExceptions = fn => async (...args) => {
  const uninstall = installUnhandledRejectionMode();

  try {
    const value = await fn(...args);
    return value;
  } finally {
    // don't remove it immediatly to let nodejs emit the unhandled rejection
    setTimeout(() => {
      uninstall();
    });
  }
};

const installUnhandledRejectionMode = () => {
  const unhandledRejectionArg = getCommandArgument(process.execArgv, "--unhandled-rejections");

  if (unhandledRejectionArg === "strict") {
    return () => {};
  }

  if (unhandledRejectionArg === "throw") {
    return () => {};
  }

  const onUnhandledRejection = reason => {
    throw reason;
  };

  process.once("unhandledRejection", onUnhandledRejection);
  return () => {
    console.log("remove");
    process.removeListener("unhandledRejection", onUnhandledRejection);
  };
};

const getCommandArgument = (argv, name) => {
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === name) {
      return {
        name,
        index: i,
        value: ""
      };
    }

    if (arg.startsWith(`${name}=`)) {
      return {
        name,
        index: i,
        value: arg.slice(`${name}=`.length)
      };
    }

    i++;
  }

  return null;
};

const executeAsyncFunction = (fn, {
  catchCancellation = false,
  considerUnhandledRejectionsAsExceptions = false
} = {}) => {
  if (catchCancellation) {
    fn = wrapFunctionToCatchCancellation(fn);
  }

  if (considerUnhandledRejectionsAsExceptions) {
    fn = wrapFunctionToConsiderUnhandledRejectionsAsExceptions(fn);
  }

  return fn();
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

const isWindows = process.platform === "win32";

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

const memoize = compute => {
  let memoized = false;
  let memoizedValue;

  const fnWithMemoization = (...args) => {
    if (memoized) {
      return memoizedValue;
    } // if compute is recursive wait for it to be fully done before storing the value
    // so set memoized boolean after the call


    memoizedValue = compute(...args);
    memoized = true;
    return memoizedValue;
  };

  fnWithMemoization.forget = () => {
    const value = memoizedValue;
    memoized = false;
    memoizedValue = undefined;
    return value;
  };

  return fnWithMemoization;
};

const readFilePromisified = util.promisify(fs.readFile);

const isWindows$3 = process.platform === "win32";

/* eslint-disable import/max-dependencies */
const isLinux = process.platform === "linux"; // linux does not support recursive option

const timeStart = name => {
  // as specified in https://w3c.github.io/server-timing/#the-performanceservertiming-interface
  // duration is a https://www.w3.org/TR/hr-time-2/#sec-domhighrestimestamp
  const startTimestamp = perf_hooks.performance.now();

  const timeEnd = () => {
    const endTimestamp = perf_hooks.performance.now();
    const timing = {
      [name]: endTimestamp - startTimestamp
    };
    return timing;
  };

  return timeEnd;
};
const timeFunction = (name, fn) => {
  const timeEnd = timeStart(name);
  const returnValue = fn();

  if (returnValue && typeof returnValue.then === "function") {
    return returnValue.then(value => {
      return [timeEnd(), value];
    });
  }

  return [timeEnd(), returnValue];
}; // to predict order in chrome devtools we should put a,b,c,d,e or something
// because in chrome dev tools they are shown in alphabetic order
// also we should manipulate a timing object instead of a header to facilitate
// manipulation of the object so that the timing header response generation logic belongs to @jsenv/server
// so response can return a new timing object
// yes it's awful, feel free to PR with a better approach :)

const timingToServerTimingResponseHeaders = timing => {
  const serverTimingValue = Object.keys(timing).map((key, index) => {
    const time = timing[key];
    return `${letters[index] || "zz"};desc="${key}";dur=${time}`;
  }).join(", ");
  return {
    "server-timing": serverTimingValue
  };
};
const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t"];

const jsenvContentTypeMap = {
  "application/javascript": {
    extensions: ["js", "cjs", "mjs", "ts", "jsx"]
  },
  "application/json": {
    extensions: ["json"]
  },
  "application/importmap+json": {
    extensions: ["importmap"]
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

const {
  readFile
} = fs.promises;
const ETAG_CACHE = new Map();
const ETAG_CACHE_MAX_SIZE = 500;
const serveFile = async (source, {
  cancellationToken = createCancellationToken(),
  method = "GET",
  headers = {},
  contentTypeMap = jsenvContentTypeMap,
  etagEnabled = false,
  etagCacheDisabled = false,
  mtimeEnabled = false,
  cacheControl = etagEnabled || mtimeEnabled ? "private,max-age=0,must-revalidate" : "no-store",
  canReadDirectory = false,
  readableStreamLifetimeInSeconds = 5
} = {}) => {
  // here you might be tempted to add || cacheControl === 'no-cache'
  // but no-cache means ressource can be cache but must be revalidated (yeah naming is strange)
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#Cacheability
  if (cacheControl === "no-store") {
    if (etagEnabled) {
      console.warn(`cannot enable etag when cache-control is ${cacheControl}`);
      etagEnabled = false;
    }

    if (mtimeEnabled) {
      console.warn(`cannot enable mtime when cache-control is ${cacheControl}`);
      mtimeEnabled = false;
    }
  }

  if (etagEnabled && mtimeEnabled) {
    console.warn(`cannot enable both etag and mtime, mtime disabled in favor of etag.`);
    mtimeEnabled = false;
  }

  if (method !== "GET" && method !== "HEAD") {
    return {
      status: 501
    };
  }

  const sourceUrl = assertAndNormalizeFileUrl(source);

  try {
    const [readStatTiming, sourceStat] = await timeFunction("file service>read file stat", () => fs.statSync(urlToFileSystemPath(sourceUrl)));
    const clientCacheResponse = await getClientCacheResponse({
      cancellationToken,
      etagEnabled,
      etagCacheDisabled,
      mtimeEnabled,
      method,
      headers,
      sourceStat,
      sourceUrl
    }); // send 304 (redirect response to client cache)
    // because the response body does not have to be transmitted

    if (clientCacheResponse.status === 304) {
      return composeResponse({
        timing: readStatTiming,
        headers: { ...(cacheControl ? {
            "cache-control": cacheControl
          } : {})
        }
      }, clientCacheResponse);
    }

    const rawResponse = await getRawResponse({
      cancellationToken,
      canReadDirectory,
      contentTypeMap,
      method,
      headers,
      sourceStat,
      sourceUrl
    }); // do not keep readable stream opened on that file
    // otherwise file is kept open forever.
    // moreover it will prevent to unlink the file on windows.

    if (clientCacheResponse.body) {
      rawResponse.body.destroy();
    } else if (readableStreamLifetimeInSeconds && readableStreamLifetimeInSeconds !== Infinity) {
      // safe measure, ensure the readable stream gets used in the next ${readableStreamLifetimeInSeconds} otherwise destroys it
      const timeout = setTimeout(() => {
        console.warn(`readable stream on ${sourceUrl} still unused after ${readableStreamLifetimeInSeconds} seconds -> destroying it to release file handle`);
        rawResponse.body.destroy();
      }, readableStreamLifetimeInSeconds * 1000);
      onceReadableStreamUsedOrClosed(rawResponse.body, () => {
        clearTimeout(timeout);
      });
    }

    return composeResponse({
      timing: readStatTiming,
      headers: { ...(cacheControl ? {
          "cache-control": cacheControl
        } : {}) // even if client cache is disabled, server can still
        // send his own cache control but client should just ignore it
        // and keep sending cache-control: 'no-store'
        // if not, uncomment the line below to preserve client
        // desire to ignore cache
        // ...(headers["cache-control"] === "no-store" ? { "cache-control": "no-store" } : {}),

      }
    }, rawResponse, clientCacheResponse);
  } catch (e) {
    return convertFileSystemErrorToResponseProperties(e);
  }
};

const getClientCacheResponse = async ({
  headers,
  etagEnabled,
  etagCacheDisabled,
  mtimeEnabled,
  ...rest
}) => {
  // here you might be tempted to add || headers["cache-control"] === "no-cache"
  // but no-cache means ressource can be cache but must be revalidated (yeah naming is strange)
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#Cacheability
  if (headers["cache-control"] === "no-store" || // let's disable it on no-cache too (https://github.com/jsenv/jsenv-server/issues/17)
  headers["cache-control"] === "no-cache") {
    return {
      status: 200
    };
  }

  if (etagEnabled) {
    return getEtagResponse({
      etagCacheDisabled,
      headers,
      ...rest
    });
  }

  if (mtimeEnabled) {
    return getMtimeResponse({
      headers,
      ...rest
    });
  }

  return {
    status: 200
  };
};

const getEtagResponse = async ({
  etagCacheDisabled,
  cancellationToken,
  sourceUrl,
  sourceStat,
  headers
}) => {
  const [computeEtagTiming, fileContentEtag] = await timeFunction("file service>generate file etag", () => computeEtag({
    cancellationToken,
    etagCacheDisabled,
    headers,
    sourceUrl,
    sourceStat
  }));
  const requestHasIfNoneMatchHeader = ("if-none-match" in headers);

  if (requestHasIfNoneMatchHeader && headers["if-none-match"] === fileContentEtag) {
    return {
      status: 304,
      timing: computeEtagTiming
    };
  }

  return {
    status: 200,
    headers: {
      etag: fileContentEtag
    },
    timing: computeEtagTiming
  };
};

const computeEtag = async ({
  cancellationToken,
  etagCacheDisabled,
  sourceUrl,
  sourceStat
}) => {
  if (!etagCacheDisabled) {
    const etagCacheEntry = ETAG_CACHE.get(sourceUrl);

    if (etagCacheEntry && fileStatAreTheSame(etagCacheEntry.sourceStat, sourceStat)) {
      return etagCacheEntry.eTag;
    }
  }

  const fileContentAsBuffer = await createOperation({
    cancellationToken,
    start: () => readFile(urlToFileSystemPath(sourceUrl))
  });
  const eTag = bufferToEtag(fileContentAsBuffer);

  if (!etagCacheDisabled) {
    if (ETAG_CACHE.size >= ETAG_CACHE_MAX_SIZE) {
      const firstKey = Array.from(ETAG_CACHE.keys())[0];
      ETAG_CACHE.delete(firstKey);
    }

    ETAG_CACHE.set(sourceUrl, {
      sourceStat,
      eTag
    });
  }

  return eTag;
}; // https://nodejs.org/api/fs.html#fs_class_fs_stats


const fileStatAreTheSame = (leftFileStat, rightFileStat) => {
  return fileStatKeysToCompare.every(keyToCompare => {
    const leftValue = leftFileStat[keyToCompare];
    const rightValue = rightFileStat[keyToCompare];
    return leftValue === rightValue;
  });
};

const fileStatKeysToCompare = [// mtime the the most likely to change, check it first
"mtimeMs", "size", "ctimeMs", "ino", "mode", "uid", "gid", "blksize"];

const getMtimeResponse = async ({
  sourceStat,
  headers
}) => {
  if ("if-modified-since" in headers) {
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
    headers: {
      "last-modified": dateToUTCString(sourceStat.mtime)
    }
  };
};

const getRawResponse = async ({
  cancellationToken,
  sourceStat,
  sourceUrl,
  canReadDirectory,
  contentTypeMap
}) => {
  if (sourceStat.isDirectory()) {
    if (canReadDirectory === false) {
      return {
        status: 403,
        statusText: "not allowed to read directory"
      };
    }

    const [readDirectoryTiming, directoryContentArray] = await timeFunction("file service>read directory", () => createOperation({
      cancellationToken,
      start: () => readDirectory(sourceUrl)
    }));
    const directoryContentJson = JSON.stringify(directoryContentArray);
    return {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": directoryContentJson.length
      },
      body: directoryContentJson,
      timing: readDirectoryTiming
    };
  } // not a file, give up


  if (!sourceStat.isFile()) {
    return {
      status: 404
    };
  }

  return {
    status: 200,
    headers: {
      "content-type": urlToContentType(sourceUrl, contentTypeMap),
      "content-length": sourceStat.size
    },
    body: fs.createReadStream(urlToFileSystemPath(sourceUrl), {
      emitClose: true
    })
  };
};

const onceReadableStreamUsedOrClosed = (readableStream, callback) => {
  const dataOrCloseCallback = () => {
    readableStream.removeListener("data", dataOrCloseCallback);
    readableStream.removeListener("close", dataOrCloseCallback);
    callback();
  };

  readableStream.on("data", dataOrCloseCallback);
  readableStream.on("close", dataOrCloseCallback);
}; // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toUTCString


const dateToUTCString = date => date.toUTCString();

const dateToSecondsPrecision = date => {
  const dateWithSecondsPrecision = new Date(date);
  dateWithSecondsPrecision.setMilliseconds(0);
  return dateWithSecondsPrecision;
};

const require$1 = module$1.createRequire(url);

const nodeFetch = require$1("node-fetch");

const AbortController = require$1("abort-controller");

const {
  Response
} = nodeFetch;
const fetchUrl = async (url, {
  cancellationToken = createCancellationToken(),
  simplified = false,
  ignoreHttpsError = false,
  canReadDirectory,
  contentTypeMap,
  cacheStrategy,
  ...options
} = {}) => {
  try {
    url = String(new URL(url));
  } catch (e) {
    throw new Error(`fetchUrl first argument must be an absolute url, received ${url}`);
  }

  if (url.startsWith("file://")) {
    const {
      status,
      statusText,
      headers,
      body
    } = await serveFile(url, {
      cancellationToken,
      cacheStrategy,
      canReadDirectory,
      contentTypeMap,
      ...options
    });
    const response = new Response(typeof body === "string" ? Buffer.from(body) : body, {
      url,
      status,
      statusText,
      headers
    });
    return simplified ? standardResponseToSimplifiedResponse(response) : response;
  } // cancellation might be requested early, abortController does not support that
  // so we have to throw if requested right away


  cancellationToken.throwIfRequested(); // https://github.com/bitinn/node-fetch#request-cancellation-with-abortsignal

  const abortController = new AbortController();
  let cancelError;
  cancellationToken.register(reason => {
    cancelError = reason;
    abortController.abort(reason);
  });
  let response;

  try {
    response = await nodeFetch(url, {
      signal: abortController.signal,
      ...(ignoreHttpsError && url.startsWith("https") ? {
        agent: new https.Agent({
          rejectUnauthorized: false
        })
      } : {}),
      ...options
    });
  } catch (e) {
    if (e.message.includes("reason: connect ECONNRESET")) {
      if (cancelError) {
        throw cancelError;
      }

      throw e;
    }

    if (e.name === "AbortError") {
      if (cancelError) {
        throw cancelError;
      }

      throw e;
    }

    throw e;
  }

  return simplified ? standardResponseToSimplifiedResponse(response) : response;
};

const standardResponseToSimplifiedResponse = async response => {
  const text = await response.text();
  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    headers: responseToHeaders(response),
    body: text
  };
};

const responseToHeaders = response => {
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
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

  try {
    await listenOperation;
  } catch (error) {
    if (error && error.code === "EADDRINUSE") {
      return false;
    }

    if (error && error.code === "EACCES") {
      return false;
    }

    return Promise.reject(error);
  }

  const stopPromise = listenOperation.stop(); // cancellation must wait for server to be closed before considering
  // cancellation as done

  cancellationToken.register(() => stopPromise);
  await stopPromise;
  return true;
};

const firstService = (...callbacks) => {
  return request => {
    return firstOperationMatching({
      array: callbacks,
      start: callback => callback(request),
      predicate: serviceGeneratedResponsePredicate
    });
  };
};
const firstServiceWithTiming = namedServices => {
  return async request => {
    const servicesTiming = {};
    const response = await firstOperationMatching({
      array: Object.keys(namedServices).map(serviceName => {
        return {
          serviceName,
          serviceFn: namedServices[serviceName]
        };
      }),
      start: async ({
        serviceName,
        serviceFn
      }) => {
        const [serviceTiming, value] = await timeFunction(serviceName, () => serviceFn(request));
        Object.assign(servicesTiming, serviceTiming);
        return value;
      },
      predicate: value => {
        if (value === null) {
          return false;
        }

        return typeof value === "object";
      }
    });

    if (response) {
      return composeResponse({
        timing: servicesTiming
      }, response);
    }

    return null;
  };
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
MIIEpAIBAAKCAQEA7g8u1+cEfCDTX2aMPkCjehz29cJpSqL8DZD7SPvznmXMXY8U
/TcIcqN3NtPlAyNIjE/5NiQkPJKtgx06E5J1eGFQn8yt54E+2eQNNjz0elxkHmmN
HwqbD76r6JuIoh/vfNhyw+2jaOO8R+sAJGywu2jFaDtxhho+1xaK1m92zdhu5U3K
QMg97xuYx+/ezb4JllFBtcs3/uE2Hg50pWO6eny1EtEDfnMhE5L42DyMtoHU+Exd
F3bGo9FxCq04UFU+ZRCuLUIY/AI8PsMcgcwq7n+O0ijylFoatmyudx+VMoHENWAL
lBdfjALE3K3XPX6s2IzAVAa4CDpmC2aQ3UCElQIDAQABAoIBAQDh4TYpVeJDhUIK
e1sGln6HF4Scm+McFpnipXZJQgdefGj1PRZFTTqOy9wKAfSCjbAAssFcRd68OtC4
X7sDZyxfFLdTaPp5d4ETbfe7RwsSLygwUya8FWwb/GdRRoLWkkbCxv3eOlWa6Lt1
4d04sojeygLFa+HDxJNrss/5t7mahbX02xTxM5O6Ly+gQDheIepjDNFmXPCvoVHq
Dk3tNeEPsP6qECBWfbfz6eGGBvWsp/copc7ndL+svDmXyJsbZxaOJg0nJ6k4sMOW
lTueGsr9t/H2wghhquNDK/Vy4e2YQhZ6VG6L0Yy2UtUfIO3JQbSYHIZpSMj1Mdkh
t675JTfhAoGBAPjTzrkCkIj9g3GITNk556ZQ9W3O8NzbmBtyxdcAQTFhL69K81wy
MrMvZ2YHPs+WwO6KrGLabDb2qf5xohp8Rgl09f3TjF+1L+ouVjYtKqIaiatA0q3R
9jpSicyGPSmoo+i2VcHgar3IFcVxGdJoZR+LWR0o7Q1u/WN8HqkkWyp/AoGBAPTr
6e61xIwlpt4adFFutfpjEaQRWGZ7PtJ+4xQpcztzAYseuBkofierDeCKzkPPsw1J
1muLYJ9puJjRe/AykoqlF+iloxTM21wlEmtnvVOi+YvFBxj5YJiAiuEGB+42tVH5
+QbPkcm/lI3reJBuzqrvZkv3fsQhk18Gb0JSWn7rAoGAMS3jyMtJ99lrVlAjKDf6
ofOUXoytLGm2iY5IrfLd772OqC2/JbTCMoom/JJoBq18GmmMIsma484i0Shyapuv
WAUm7XEXaH8uJjHcVj7dE0b9eLyKJ1K9QM+5bpQFmKs9IiyPjI8nabUXIHv3J4/8
lJx9E3dYSvRp3nTUtod6AU8CgYEAlz/5P0lRD5tQ6Wg83O0ZxH7ZrhBoHyGNMkDZ
yuGuH9Bt65QU7LRs8+JWt4wAxS/GyzYGDHQOP2Pyc60qdLNGfAhoM2vWwkmgTc83
CM0Pxk6m/QG32FxoosT+/ufSjfGLGAzfFK2qwoRlIR+BXPCRAE7HRbKZvlVdxRkc
LEDfUfECgYANyg47HujS+lZb+3zm2/D/nP25BuGxADL07i4yHIxGSqEYS6MJAOq8
0fJCOcOeK4XypFGvrVyZiVkWd3qTE1BuIFFRpqER7HYvThPBkJ/gOwjuqZQv5syL
3+3M4qUvCSqYxAr3Bj2xpPO6ysXdPdJMqU/b/gWuS/VblvXHrMExdA==
-----END RSA PRIVATE KEY-----`;
const jsenvPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7g8u1+cEfCDTX2aMPkCj
ehz29cJpSqL8DZD7SPvznmXMXY8U/TcIcqN3NtPlAyNIjE/5NiQkPJKtgx06E5J1
eGFQn8yt54E+2eQNNjz0elxkHmmNHwqbD76r6JuIoh/vfNhyw+2jaOO8R+sAJGyw
u2jFaDtxhho+1xaK1m92zdhu5U3KQMg97xuYx+/ezb4JllFBtcs3/uE2Hg50pWO6
eny1EtEDfnMhE5L42DyMtoHU+ExdF3bGo9FxCq04UFU+ZRCuLUIY/AI8PsMcgcwq
7n+O0ijylFoatmyudx+VMoHENWALlBdfjALE3K3XPX6s2IzAVAa4CDpmC2aQ3UCE
lQIDAQAB
-----END PUBLIC KEY-----`;
const jsenvCertificate = `-----BEGIN CERTIFICATE-----
MIIECjCCAvKgAwIBAgIBATANBgkqhkiG9w0BAQsFADCBkTEuMCwGA1UEAxMlaHR0
cHM6Ly9naXRodWIuY29tL2pzZW52L2pzZW52LXNlcnZlcjELMAkGA1UEBhMCRlIx
GDAWBgNVBAgTD0FscGVzIE1hcml0aW1lczERMA8GA1UEBxMIVmFsYm9ubmUxDjAM
BgNVBAoTBWpzZW52MRUwEwYDVQQLEwxqc2VudiBzZXJ2ZXIwHhcNMjAwNTAzMTg0
NzU0WhcNMjkwNTAzMTg0NzU1WjCBkTEuMCwGA1UEAxMlaHR0cHM6Ly9naXRodWIu
Y29tL2pzZW52L2pzZW52LXNlcnZlcjELMAkGA1UEBhMCRlIxGDAWBgNVBAgTD0Fs
cGVzIE1hcml0aW1lczERMA8GA1UEBxMIVmFsYm9ubmUxDjAMBgNVBAoTBWpzZW52
MRUwEwYDVQQLEwxqc2VudiBzZXJ2ZXIwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw
ggEKAoIBAQDuDy7X5wR8INNfZow+QKN6HPb1wmlKovwNkPtI+/OeZcxdjxT9Nwhy
o3c20+UDI0iMT/k2JCQ8kq2DHToTknV4YVCfzK3ngT7Z5A02PPR6XGQeaY0fCpsP
vqvom4iiH+982HLD7aNo47xH6wAkbLC7aMVoO3GGGj7XForWb3bN2G7lTcpAyD3v
G5jH797NvgmWUUG1yzf+4TYeDnSlY7p6fLUS0QN+cyETkvjYPIy2gdT4TF0Xdsaj
0XEKrThQVT5lEK4tQhj8Ajw+wxyBzCruf47SKPKUWhq2bK53H5UygcQ1YAuUF1+M
AsTcrdc9fqzYjMBUBrgIOmYLZpDdQISVAgMBAAGjazBpMB8GA1UdIwQYMBaAFFJJ
BlTW2Lp6maSe/c6HfH+zee1xMA4GA1UdDwEB/wQEAwIFoDATBgNVHSUEDDAKBggr
BgEFBQcDATAhBgNVHREEGjAYhwR/AAABgglsb2NhbGhvc3SCBWpzZW52MA0GCSqG
SIb3DQEBCwUAA4IBAQCJdOdqU0XBoto/ddAbTRC+qzmIl43w6zsUBO/5zEGDIs6x
MwOOqMzuKtZ4Qm2hYTFfITRrinU2L3XmGdRdGzHF8V6VpOR1D+BZy0IvJBBW7DTE
zuaBqQ5qtY1x1qtZdWaWZwexQjGlBdXa+yCWCOHs8amlH8WS6jOfvrD/ECpVbvJQ
Xi+4yFFBeJ4P09Wx4YetDSJWFBL1Y5Q3TnqpyxNYZ3A3r/UolbG/HY0NnOGUA6wg
MHOw0+Zg5Ls7pHo2bN7n1LseYeIt6M90q8/vRS6VjzWImJswxsdqSCP8TZxVb5S5
p2OCbNpxQVtgLpUgLd9ePT2eX2kRTI8knM+C+e7L
-----END CERTIFICATE-----`;

const urlToSearchParamValue = (url, searchParamName) => {
  return new URL(url).searchParams.get(searchParamName);
};

const readRequestBodyAsString = body => {
  return new Promise((resolve, reject) => {
    const bufferArray = [];
    body.subscribe({
      error: reject,
      next: buffer => {
        bufferArray.push(buffer);
      },
      complete: () => {
        const bodyAsBuffer = Buffer.concat(bufferArray);
        const bodyAsString = bodyAsBuffer.toString();
        resolve(bodyAsString);
      }
    });
  });
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

const urlToOrigin = url => {
  return new URL(url).origin;
};

const createServer = async ({
  http2,
  http1Allowed,
  protocol,
  privateKey,
  certificate
}) => {
  if (protocol === "http") {
    if (http2) {
      const {
        createServer
      } = await Promise.resolve().then(function () { return /*#__PURE__*/_interopNamespace(require('http2')); });
      return createServer();
    }

    const {
      createServer
    } = await Promise.resolve().then(function () { return /*#__PURE__*/_interopNamespace(require('http')); });
    return createServer();
  }

  if (protocol === "https") {
    if (http2) {
      const {
        createSecureServer
      } = await Promise.resolve().then(function () { return /*#__PURE__*/_interopNamespace(require('http2')); });
      return createSecureServer({
        key: privateKey,
        cert: certificate,
        allowHTTP1: http1Allowed
      });
    }

    const {
      createServer
    } = await Promise.resolve().then(function () { return /*#__PURE__*/_interopNamespace(require('https')); });
    return createServer({
      key: privateKey,
      cert: certificate
    });
  }

  throw new Error(`unsupported protocol ${protocol}`);
};

const trackServerPendingConnections = (nodeServer, {
  http2,
  onConnectionError
}) => {
  if (http2) {
    // see http2.js: we rely on https://nodejs.org/api/http2.html#http2_compatibility_api
    return trackHttp1ServerPendingConnections(nodeServer, {
      onConnectionError
    });
  }

  return trackHttp1ServerPendingConnections(nodeServer, {
    onConnectionError
  });
}; // const trackHttp2ServerPendingSessions = () => {}

const trackHttp1ServerPendingConnections = (nodeServer, {
  onConnectionError
}) => {
  const pendingConnections = new Set();

  const connectionListener = connection => {
    connection.on("close", () => {
      pendingConnections.delete(connection);
    });

    if (onConnectionError) {
      connection.on("error", error => {
        onConnectionError(error, connection);
      });
    }

    pendingConnections.add(connection);
  };

  nodeServer.on("connection", connectionListener);

  const stop = async reason => {
    nodeServer.removeListener("connection", connectionListener);
    await Promise.all(Array.from(pendingConnections).map(pendingConnection => {
      return new Promise((resolve, reject) => {
        pendingConnection.destroy(reason, error => {
          if (error) {
            if (error === reason || error.code === "ENOTCONN") {
              resolve();
            } else {
              reject(error);
            }
          } else {
            resolve();
          }
        });
      });
    }));
  };

  return {
    stop
  };
};

const trackServerPendingRequests = (nodeServer, {
  http2
}) => {
  if (http2) {
    // see http2.js: we rely on https://nodejs.org/api/http2.html#http2_compatibility_api
    return trackHttp1ServerPendingRequests(nodeServer);
  }

  return trackHttp1ServerPendingRequests(nodeServer);
}; // const trackHttp2ServerPendingStreams = () => {}

const trackHttp1ServerPendingRequests = nodeServer => {
  const pendingClients = new Set();

  const requestListener = (nodeRequest, nodeResponse) => {
    const client = {
      nodeRequest,
      nodeResponse
    };
    pendingClients.add(client);
    nodeResponse.on("close", () => {
      pendingClients.delete(client);
    });
  };

  nodeServer.on("request", requestListener);

  const stop = ({
    status,
    reason
  }) => {
    nodeServer.removeListener("request", requestListener);
    return Promise.all(Array.from(pendingClients).map(({
      nodeResponse
    }) => {
      if (nodeResponse.headersSent === false) {
        nodeResponse.writeHead(status, reason);
      } // http2


      if (nodeResponse.close) {
        return new Promise((resolve, reject) => {
          if (nodeResponse.closed) {
            resolve();
          } else {
            nodeResponse.close(error => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          }
        });
      } // http


      return new Promise(resolve => {
        if (nodeResponse.destroyed) {
          resolve();
        } else {
          nodeResponse.once("close", () => {
            resolve();
          });
          nodeResponse.destroy();
        }
      });
    }));
  };

  return {
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
      // should we do nodeStream.resume() in case the stream was paused ?
      nodeStream.on("data", next);
      nodeStream.once("error", error);
      nodeStream.once("end", complete);

      const unsubscribe = () => {
        nodeStream.removeListener("data", next);
        nodeStream.removeListener("error", error);
        nodeStream.removeListener("end", complete);

        if (typeof nodeStream.abort === "function") {
          nodeStream.abort();
        } else {
          nodeStream.destroy();
        }
      };

      if (typeof nodeStream.once === "function") {
        nodeStream.once("abort", unsubscribe);
      }

      return {
        unsubscribe
      };
    }
  });
};

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
    if (headerName[0] === ":") {
      // exclude http2 headers
      return;
    }

    headers[normalizeHeaderName(headerName)] = normalizeHeaderValue(headersObject[headerName]);
  });
  return headers;
};

const nodeRequestToRequest = (nodeRequest, {
  serverCancellationToken,
  serverOrigin
}) => {
  const {
    method
  } = nodeRequest;
  const {
    url: ressource
  } = nodeRequest;
  const headers = headersFromObject(nodeRequest.headers);
  const body = method === "POST" || method === "PUT" || method === "PATCH" ? nodeStreamToObservable(nodeRequest) : undefined;
  let requestOrigin;

  if (nodeRequest.authority) {
    requestOrigin = nodeRequest.connection.encrypted ? `https://${nodeRequest.authority}` : `http://${nodeRequest.authority}`;
  } else if (nodeRequest.headers.host) {
    requestOrigin = nodeRequest.connection.encrypted ? `https://${nodeRequest.headers.host}` : `http://${nodeRequest.headers.host}`;
  } else {
    requestOrigin = serverOrigin;
  }

  return Object.freeze({
    // the node request is considered as cancelled if client cancels or server cancels.
    // in case of server cancellation from a client perspective request is not cancelled
    // because client still wants a response. But from a server perspective the production
    // of a response for this request is cancelled
    cancellationToken: composeCancellationToken(serverCancellationToken, nodeRequestToCancellationToken(nodeRequest)),
    origin: requestOrigin,
    ressource,
    method,
    headers,
    body
  });
};

const nodeRequestToCancellationToken = nodeRequest => {
  const {
    cancel,
    token
  } = createCancellationSource();
  nodeRequest.on("abort", () => {
    cancel("request aborted");
  });
  nodeRequest.on("close", () => {
    cancel("request closed");
  });
  return token;
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
  cancellationToken,
  ignoreBody,
  ignoreStatusText,
  ignoreConnectionHeader
} = {}) => {
  const nodeHeaders = headersToNodeHeaders(headers, {
    ignoreConnectionHeader
  }); // nodejs strange signature for writeHead force this
  // https://nodejs.org/api/http.html#http_response_writehead_statuscode_statusmessage_headers

  if (statusText === undefined || ignoreStatusText) {
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
      try {
        nodeResponse.write(data);
      } catch (e) {
        // Something inside Node.js sometimes puts stream
        // in a state where .write() throw despites nodeResponse.destroyed
        // being undefined and "close" event not being emitted.
        // I have tested if we are the one calling destroy
        // (I have commented every .destroy() call)
        // but issue still occurs
        // For the record it's "hard" to reproduce but can be by running
        // a lot of tests against a browser in the context of @jsenv/core testing
        if (e.code === "ERR_HTTP2_INVALID_STREAM") {
          return;
        }

        throw e;
      }
    },
    error: value => {
      nodeResponse.emit("error", value);
    },
    complete: () => {
      nodeResponse.end();
    }
  });
  cancellationToken.register(() => {
    subscription.unsubscribe();
    nodeResponse.destroy();
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

const headersToNodeHeaders = (headers, {
  ignoreConnectionHeader
}) => {
  const nodeHeaders = {};
  Object.keys(headers).forEach(name => {
    if (name === "connection" && ignoreConnectionHeader) return;
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

const getServerOrigins = ({
  protocol,
  ip,
  port
}) => {
  return {
    main: createServerOrigin({
      protocol,
      ip,
      port
    }),
    external: createServerOrigin({
      protocol,
      ip: getExternalIp(),
      port
    })
  };
};

const createServerOrigin = ({
  protocol,
  ip,
  port
}) => {
  const url = new url$1.URL("https://127.0.0.1:80");
  url.protocol = protocol;
  url.hostname = ipToHostname(ip);
  url.port = port;
  return url.origin;
};

const ipToHostname = (ip, {
  preferLocalhost = true,
  preferLocalIp = false,
  preferExternalIp = false
} = {}) => {
  if (ip === "0.0.0.0" || !ip) {
    if (preferLocalhost) return "localhost";
    if (preferLocalIp) return "127.0.0.1";
    if (preferExternalIp) return getExternalIp() || "0.0.0.0";
    return "0.0.0.0";
  }

  return ip;
};

const getExternalIp = () => {
  const networkInterfaceMap = os.networkInterfaces();
  let internalIPV4NetworkAddress;
  Object.keys(networkInterfaceMap).find(key => {
    const networkAddressArray = networkInterfaceMap[key];
    return networkAddressArray.find(networkAddress => {
      if (networkAddress.internal) return false;
      if (networkAddress.family !== "IPv4") return false;
      internalIPV4NetworkAddress = networkAddress;
      return true;
    });
  });
  return internalIPV4NetworkAddress ? internalIPV4NetworkAddress.address : null;
};

const createReason = reasonString => {
  return {
    toString: () => reasonString
  };
};

const STOP_REASON_INTERNAL_ERROR = createReason("Internal error");
const STOP_REASON_PROCESS_SIGHUP = createReason("process SIGHUP");
const STOP_REASON_PROCESS_SIGTERM = createReason("process SIGTERM");
const STOP_REASON_PROCESS_SIGINT = createReason("process SIGINT");
const STOP_REASON_PROCESS_BEFORE_EXIT = createReason("process before exit");
const STOP_REASON_PROCESS_EXIT = createReason("process exit");
const STOP_REASON_NOT_SPECIFIED = createReason("not specified");

const trackServerRequest = (nodeServer, fn, {
  http2
}) => {
  if (http2) {
    // see http2.js: we rely on https://nodejs.org/api/http2.html#http2_compatibility_api
    return trackHttp1ServerRequest(nodeServer, fn);
  }

  return trackHttp1ServerRequest(nodeServer, fn);
}; // const trackHttp2ServerRequest = (nodeServer, fn) => {
//   nodeServer.on("stream", fn)
//   return () => {
//     nodeServer.removeListener("stream", fn)
//   }
// }

const trackHttp1ServerRequest = (nodeServer, fn) => {
  nodeServer.on("request", fn);
  return () => {
    nodeServer.removeListener("request", fn);
  };
};

const require$2 = module$1.createRequire(url);

const killPort = require$2("kill-port");

const startServer = async ({
  cancellationToken = createCancellationToken(),
  logLevel,
  serverName = "server",
  protocol = "http",
  http2 = false,
  http1Allowed = true,
  redirectHttpToHttps = false,
  ip = "0.0.0.0",
  // will it work on windows ? https://github.com/nodejs/node/issues/14900
  port = 0,
  // assign a random available port
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
  requestWaitingMs = 20000,
  requestWaitingCallback = (request, {
    logger
  }) => {
    logger.warn(`still no response found for request after ${requestWaitingMs} ms
--- request url ---
${request.origin}${request.ressource}
--- request headers ---
${JSON.stringify(request.headers, null, "  ")}
`);
  },
  startedCallback = () => {},
  stoppedCallback = () => {},
  errorIsCancellation = () => false,
  nagle = true
} = {}) => {
  return executeAsyncFunction(async () => {
    if (port === 0 && forcePort) {
      throw new Error(`no need to pass forcePort when port is 0`);
    }

    if (protocol !== "http" && protocol !== "https") {
      throw new Error(`protocol must be http or https, got ${protocol}`);
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
    }

    if (http2 && protocol !== "https") {
      throw new Error(`http2 needs "https" but protocol is "${protocol}"`);
    }

    const internalCancellationSource = createCancellationSource();
    const externalCancellationToken = cancellationToken;
    const internalCancellationToken = internalCancellationSource.token;
    const serverCancellationToken = composeCancellationToken(externalCancellationToken, internalCancellationToken);
    const logger = createLogger({
      logLevel
    });

    if (redirectHttpToHttps && protocol === "http") {
      logger.warn(`redirectHttpToHttps ignored because protocol is http`);
      redirectHttpToHttps = false;
    }

    if (redirectHttpToHttps && http2) {
      logger.warn(`redirectHttpToHttps ignored because it does not work with http2. see https://github.com/nodejs/node/issues/23331`);
      redirectHttpToHttps = false;
    }

    const onError = error => {
      if (errorIsCancellation(error)) {
        return;
      }

      throw error;
    };

    errorIsCancellation = composePredicate(errorIsCancellation, isCancelError);
    const {
      registerCleanupCallback,
      cleanup
    } = createTracker();

    if (stopOnCrash) {
      const unregister = unadvisedCrashSignal.addCallback(reason => {
        internalCancellationSource.cancel(reason.value);
      });
      registerCleanupCallback(unregister);
    }

    if (stopOnExit) {
      const unregister = teardownSignal.addCallback(tearDownReason => {
        if (!stopOnSIGINT && tearDownReason === "SIGINT") {
          return;
        }

        internalCancellationSource.cancel({
          SIGHUP: STOP_REASON_PROCESS_SIGHUP,
          SIGTERM: STOP_REASON_PROCESS_SIGTERM,
          SIGINT: STOP_REASON_PROCESS_SIGINT,
          beforeExit: STOP_REASON_PROCESS_BEFORE_EXIT,
          exit: STOP_REASON_PROCESS_EXIT
        }[tearDownReason]);
      });
      registerCleanupCallback(unregister);
    } else if (stopOnSIGINT) {
      const unregister = SIGINTSignal.addCallback(() => {
        internalCancellationSource.cancel(STOP_REASON_PROCESS_SIGINT);
      });
      registerCleanupCallback(unregister);
    }

    if (forcePort) {
      await createOperation({
        cancellationToken: serverCancellationToken,
        start: () => killPort(port)
      });
    }

    const nodeServer = await createServer({
      http2,
      http1Allowed,
      protocol,
      privateKey,
      certificate
    }); // https://nodejs.org/api/net.html#net_server_unref

    if (!keepProcessAlive) {
      nodeServer.unref();
    }

    let status = "starting";
    let stoppedResolve;
    const stoppedPromise = new Promise(resolve => {
      stoppedResolve = resolve;
    });
    const stop = memoize(async (reason = STOP_REASON_NOT_SPECIFIED) => {
      status = "stopping";
      errorIsCancellation = composePredicate(errorIsCancellation, error => error === reason);
      errorIsCancellation = composePredicate(errorIsCancellation, error => error && error.code === "ECONNRESET");
      logger.info(`${serverName} stopped because ${reason}`);
      await cleanup(reason);
      await stopListening(nodeServer);
      status = "stopped";
      stoppedCallback({
        reason
      });
      stoppedResolve(reason);
    });
    serverCancellationToken.register(stop);
    const startOperation = createStoppableOperation({
      cancellationToken: serverCancellationToken,
      start: async () => {
        if (portHint) {
          port = await findFreePort(portHint, {
            cancellationToken: serverCancellationToken,
            ip
          });
        }

        return listen({
          cancellationToken: serverCancellationToken,
          server: nodeServer,
          port,
          ip
        });
      },
      stop: (_, reason) => stop(reason)
    });
    port = await startOperation;
    status = "opened";
    const serverOrigins = getServerOrigins({
      protocol,
      ip,
      port
    });
    const serverOrigin = serverOrigins.main;
    const connectionsTracker = trackServerPendingConnections(nodeServer, {
      http2,
      onConnectionError: (error, connection) => {
        if (!connection.destroyed) {
          onError(error);
        }
      }
    }); // opened connection must be shutdown before the close event is emitted

    registerCleanupCallback(connectionsTracker.stop);
    const pendingRequestsTracker = trackServerPendingRequests(nodeServer, {
      http2
    }); // ensure pending requests got a response from the server

    registerCleanupCallback(reason => {
      pendingRequestsTracker.stop({
        status: reason === STOP_REASON_INTERNAL_ERROR ? 500 : 503,
        reason
      });
    });

    const requestCallback = async (nodeRequest, nodeResponse) => {
      if (!nagle) {
        nodeRequest.connection.setNoDelay(true);
      }

      if (redirectHttpToHttps && !nodeRequest.connection.encrypted) {
        nodeResponse.writeHead(301, {
          location: `${serverOrigin}${nodeRequest.ressource}`
        });
        return;
      }

      const request = nodeRequestToRequest(nodeRequest, {
        serverCancellationToken,
        serverOrigin
      });
      nodeRequest.on("error", error => {
        logger.error(`error on request.
--- request ressource ---
${request.ressource}
--- error stack ---
${error.stack}`);
      });
      const [startRespondingTiming, {
        response,
        error
      }] = await timeFunction("time to start responding", () => generateResponseDescription(request));

      if (sendServerTiming) {
        const serverTiming = { ...response.timing,
          ...startRespondingTiming
        };
        response.headers = composeResponseHeaders(timingToServerTimingResponseHeaders(serverTiming), response.headers);
      }

      logger.info(`${request.method} ${request.origin}${request.ressource}`);

      if (error && isCancelError(error) && internalCancellationToken.cancellationRequested) {
        logger.info("ignored because server closing");
        nodeResponse.destroy();
        return;
      }

      if (request.aborted) {
        logger.info(`request aborted by client`);
        nodeResponse.destroy();
        return;
      }

      if (request.method !== "HEAD" && response.headers["content-length"] > 0 && response.body === "") {
        logger.error(createContentLengthMismatchError(`content-length header is ${response.headers["content-length"]} but body is empty`));
      }

      if (error) {
        logger.error(`internal error while handling request.
--- error stack ---
${error.stack}
--- request ---
${request.method} ${request.origin}${request.ressource}`);
      }

      logger.info(`${colorizeResponseStatus(response.status)} ${response.statusText}`);
      populateNodeResponse(nodeResponse, response, {
        cancellationToken: request.cancellationToken,
        ignoreBody: request.method === "HEAD",
        // https://github.com/nodejs/node/blob/79296dc2d02c0b9872bbfcbb89148ea036a546d0/lib/internal/http2/compat.js#L97
        ignoreStatusText: Boolean(nodeRequest.stream),
        // https://github.com/nodejs/node/blob/79296dc2d02c0b9872bbfcbb89148ea036a546d0/lib/internal/http2/compat.js#L112
        ignoreConnectionHeader: Boolean(nodeRequest.stream)
      });

      if (stopOnInternalError && // stopOnInternalError stops server only if requestToResponse generated
      // a non controlled error (internal error).
      // if requestToResponse gracefully produced a 500 response (it did not throw)
      // then we can assume we are still in control of what we are doing
      error) {
        // il faudrais pouvoir stop que les autres response ?
        stop(STOP_REASON_INTERNAL_ERROR);
      }
    };

    const removeRequestListener = trackServerRequest(nodeServer, requestCallback, {
      http2
    }); // ensure we don't try to handle new requests while server is stopping

    registerCleanupCallback(removeRequestListener);
    logger.info(`${serverName} started at ${serverOrigin} (${serverOrigins.external})`);
    startedCallback({
      origin: serverOrigin
    });
    const corsEnabled = accessControlAllowRequestOrigin || accessControlAllowedOrigins.length; // here we check access control options to throw or warn if we find strange values

    const generateResponseDescription = async request => {
      const responsePropertiesToResponse = ({
        status = 501,
        statusText = statusToStatusText(status),
        headers = {},
        body = "",
        bodyEncoding,
        timing
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
            sendServerTiming
          });
          return {
            status,
            statusText,
            headers: composeResponseHeaders(headers, accessControlHeaders),
            body,
            bodyEncoding,
            timing
          };
        }

        return {
          status,
          statusText,
          headers,
          body,
          bodyEncoding,
          timing
        };
      };

      let timeout;

      try {
        if (corsEnabled && request.method === "OPTIONS") {
          return {
            response: responsePropertiesToResponse({
              status: 200,
              headers: {
                "content-length": 0
              }
            })
          };
        }

        timeout = setTimeout(() => requestWaitingCallback(request, {
          logger,
          requestWaitingMs
        }), requestWaitingMs);
        const responseProperties = await requestToResponse(request);
        clearTimeout(timeout);
        return {
          response: responsePropertiesToResponse(responseProperties || {})
        };
      } catch (error) {
        clearTimeout(timeout);
        return {
          response: composeResponse(responsePropertiesToResponse({
            status: 500,
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
      origin: serverOrigin,
      nodeServer,
      stop,
      stoppedPromise
    };
  });
};

const statusToStatusText = status => http.STATUS_CODES[status] || "not specified";

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
  accessControlMaxAge = 600,
  sendServerTiming
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
    ...(sendServerTiming ? {
      "timing-allow-origin": allowedOriginArray.join(", ")
    } : {}),
    ...(vary.length ? {
      vary: vary.join(", ")
    } : {})
  };
};

const composePredicate = (previousPredicate, predicate) => {
  return value => {
    return previousPredicate(value) || predicate(value);
  };
};

exports.STOP_REASON_INTERNAL_ERROR = STOP_REASON_INTERNAL_ERROR;
exports.STOP_REASON_NOT_SPECIFIED = STOP_REASON_NOT_SPECIFIED;
exports.STOP_REASON_PROCESS_BEFORE_EXIT = STOP_REASON_PROCESS_BEFORE_EXIT;
exports.STOP_REASON_PROCESS_EXIT = STOP_REASON_PROCESS_EXIT;
exports.STOP_REASON_PROCESS_SIGHUP = STOP_REASON_PROCESS_SIGHUP;
exports.STOP_REASON_PROCESS_SIGINT = STOP_REASON_PROCESS_SIGINT;
exports.STOP_REASON_PROCESS_SIGTERM = STOP_REASON_PROCESS_SIGTERM;
exports.acceptsContentType = acceptsContentType;
exports.composeResponse = composeResponse;
exports.convertFileSystemErrorToResponseProperties = convertFileSystemErrorToResponseProperties;
exports.createSSERoom = createSSERoom;
exports.fetchUrl = fetchUrl;
exports.findFreePort = findFreePort;
exports.firstService = firstService;
exports.firstServiceWithTiming = firstServiceWithTiming;
exports.jsenvAccessControlAllowedHeaders = jsenvAccessControlAllowedHeaders;
exports.jsenvAccessControlAllowedMethods = jsenvAccessControlAllowedMethods;
exports.jsenvCertificate = jsenvCertificate;
exports.jsenvPrivateKey = jsenvPrivateKey;
exports.jsenvPublicKey = jsenvPublicKey;
exports.readRequestBodyAsString = readRequestBodyAsString;
exports.serveFile = serveFile;
exports.startServer = startServer;
exports.timeFunction = timeFunction;
exports.timeStart = timeStart;
exports.urlToContentType = urlToContentType;
exports.urlToSearchParamValue = urlToSearchParamValue;

//# sourceMappingURL=main.cjs.map