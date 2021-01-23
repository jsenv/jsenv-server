'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var logger = require('@jsenv/logger');
var module$1 = require('module');
var https = require('https');
var cancellation = require('@jsenv/cancellation');
var util = require('@jsenv/util');
var fs = require('fs');
var perf_hooks = require('perf_hooks');
var path = require('path');
var net = require('net');
var http = require('http');
var nodeSignals = require('@jsenv/node-signals');
var stream = require('stream');
var os = require('os');
var url$1 = require('url');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

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

var net__default = /*#__PURE__*/_interopDefaultLegacy(net);
var http__default = /*#__PURE__*/_interopDefaultLegacy(http);

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

/* eslint-disable no-nested-ternary */
const compositionMappingToCompose = (compositionMapping, createInitial = () => {
  return {};
}, {
  caseSensitive = true
} = {}) => {
  const reducer = compositionMappingToReducer(compositionMapping, {
    caseSensitive
  });
  return (...objects) => objects.reduce(reducer, createInitial());
};

const compositionMappingToReducer = (compositionMapping, {
  caseSensitive
}) => {
  return (previous, current) => {
    if (typeof current !== "object" || current === null) {
      return previous;
    }

    const composed = {};
    Object.keys(previous).forEach(key => {
      const composedKey = caseSensitive ? key : key.toLowerCase();
      composed[composedKey] = previous[key];
    });
    Object.keys(current).forEach(key => {
      const composedKey = caseSensitive ? key : key.toLowerCase();
      composed[composedKey] = caseSensitive ? composeProperty(key, previous, current, compositionMapping) : composePropertyCaseInsensitive(key, previous, current, compositionMapping);
    });
    return composed;
  };
};

const composeProperty = (key, previous, current, compositionMapping) => {
  const keyExistingInCurrent = keyExistsIn(key, current) ? key : null;

  if (!keyExistingInCurrent) {
    return previous[key];
  }

  const keyExistingInPrevious = keyExistsIn(key, previous) ? key : null;

  if (!keyExistingInPrevious) {
    return current[key];
  }

  const keyExistingInComposer = keyExistsIn(key, compositionMapping) ? key : null;

  if (!keyExistingInComposer) {
    return current[key];
  }

  const composerForProperty = compositionMapping[keyExistingInComposer];
  return composerForProperty(previous[keyExistingInPrevious], current[keyExistingInCurrent]);
};

const composePropertyCaseInsensitive = (key, previous, current, compositionMapping) => {
  const keyLowercased = key.toLowerCase();
  const keyExistingInCurrent = keyExistsIn(key, current) ? key : keyExistsIn(keyLowercased, current) ? keyLowercased : null;
  const keyExistingInPrevious = keyExistsIn(key, previous) ? key : keyExistsIn(keyLowercased, previous) ? keyLowercased : null;

  if (!keyExistingInCurrent) {
    return previous[keyExistingInPrevious];
  }

  if (!keyExistingInPrevious) {
    return current[keyExistingInCurrent];
  }

  const keyExistingInComposer = keyExistsIn(keyLowercased, compositionMapping) ? keyLowercased : null;

  if (!keyExistingInComposer) {
    return current[keyExistingInCurrent];
  }

  const composerForProperty = compositionMapping[keyExistingInComposer];
  return composerForProperty(previous[keyExistingInPrevious], current[keyExistingInCurrent]);
};

const keyExistsIn = (key, object) => {
  return Object.prototype.hasOwnProperty.call(object, key);
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
const composeResponseHeaders = compositionMappingToCompose(headerCompositionMapping, () => ({}), {
  caseSensitive: false
});

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
  // do not keep process alive because of rooms, something else must keep it alive
  keepProcessAlive = false,
  keepaliveDuration = 30 * 1000,
  retryDuration = 1 * 1000,
  historyLength = 1 * 1000,
  maxConnectionAllowed = 100,
  // max 100 users accepted
  computeEventId = (event, lastEventId) => lastEventId + 1,
  welcomeEvent = false,
  welcomeEventPublic = false
} = {}) => {
  const logger$1 = logger.createLogger({
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
    if (connections.size >= maxConnectionAllowed) {
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
          logger$1.debug(`send ${event.type} event to this new client`);
          next(stringifySourceEvent(event));
        });
        const connection = {
          write: next
        };

        const unsubscribe = () => {
          if (connections.has(connection)) {
            connections.delete(connection);
            logger$1.debug(`connection closed by us, number of client connected to event source: ${connections.size}`);
          }
        };

        connection.unsubscribe = unsubscribe;
        connections.add(connection);
        return {
          unsubscribe
        };
      }
    });
    logger$1.debug(`client joined, number of client connected to event source: ${connections.size}, max allowed: ${maxConnectionAllowed}`);
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
      logger$1.debug(`send ${event.type} event, number of client listening event source: ${connections.size}`);

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
    logger$1.debug(`send keep alive event, number of client listening event source: ${connections.size}`);
    sendEvent({
      type: "comment",
      data: new Date().toLocaleTimeString()
    });
  };

  const start = () => {
    state = "started";
    interval = setInterval(keepAlive, keepaliveDuration);

    if (!keepProcessAlive) {
      interval.unref();
    }
  };

  const stop = () => {
    logger$1.debug(`stopping, number of client to close: ${connections.size}`);
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
    sendEvent,
    clientCountGetter: () => connections.size
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

/* global __filename */
const filenameContainsBackSlashes = __filename.indexOf("\\") > -1;
const url = filenameContainsBackSlashes ? `file:///${__filename.replace(/\\/g, "/")}` : `file://${__filename}`;

const applyContentNegotiation = ({
  availables,
  accepteds,
  getAcceptanceScore
}) => {
  let highestScore = -1;
  let availableWithHighestScore = null;
  let availableIndex = 0;

  while (availableIndex < availables.length) {
    const available = availables[availableIndex];
    availableIndex++;
    let acceptedIndex = 0;

    while (acceptedIndex < accepteds.length) {
      const accepted = accepteds[acceptedIndex];
      acceptedIndex++;
      const score = getAcceptanceScore(accepted, available);

      if (score > highestScore) {
        availableWithHighestScore = available;
        highestScore = score;
      }
    }
  }

  return availableWithHighestScore;
};

/**

 A multiple header is a header with multiple values like

 "text/plain, application/json;q=0.1"

 Each, means it's a new value (it's optionally followed by a space)

 Each; mean it's a property followed by =
 if "" is a string
 if not it's likely a number
 */
const parseMultipleHeader = (multipleHeaderString, {
  validateName = () => true,
  validateProperty = () => true
} = {}) => {
  const values = multipleHeaderString.split(",");
  const multipleHeader = {};
  values.forEach(value => {
    const valueTrimmed = value.trim();
    const valueParts = valueTrimmed.split(";");
    const name = valueParts[0];
    const nameValidation = validateName(name);

    if (!nameValidation) {
      return;
    }

    const properties = parseHeaderProperties(valueParts.slice(1), {
      validateProperty
    });
    multipleHeader[name] = properties;
  });
  return multipleHeader;
};

const parseHeaderProperties = (headerProperties, {
  validateProperty
}) => {
  const properties = headerProperties.reduce((previous, valuePart) => {
    const [propertyName, propertyValueString] = valuePart.split("=");
    const propertyValue = parseHeaderPropertyValue(propertyValueString);
    const property = {
      name: propertyName,
      value: propertyValue
    };
    const propertyValidation = validateProperty(property);

    if (!propertyValidation) {
      return previous;
    }

    return { ...previous,
      [property.name]: property.value
    };
  }, {});
  return properties;
};

const parseHeaderPropertyValue = headerPropertyValueString => {
  const firstChar = headerPropertyValueString[0];
  const lastChar = headerPropertyValueString[headerPropertyValueString.length - 1];

  if (firstChar === '"' && lastChar === '"') {
    return headerPropertyValueString.slice(1, -1);
  }

  if (isNaN(headerPropertyValueString)) {
    return headerPropertyValueString;
  }

  return parseFloat(headerPropertyValueString);
};

const stringifyMultipleHeader = (multipleHeader, {
  validateName = () => true,
  validateProperty = () => true
} = {}) => {
  return Object.keys(multipleHeader).filter(name => {
    const headerProperties = multipleHeader[name];

    if (!headerProperties) {
      return false;
    }

    if (typeof headerProperties !== "object") {
      return false;
    }

    const nameValidation = validateName(name);

    if (!nameValidation) {
      return false;
    }

    return true;
  }).map(name => {
    const headerProperties = multipleHeader[name];
    const headerPropertiesString = stringifyHeaderProperties(headerProperties, {
      validateProperty
    });

    if (headerPropertiesString.length) {
      return `${name};${headerPropertiesString}`;
    }

    return name;
  }).join(", ");
};

const stringifyHeaderProperties = (headerProperties, {
  validateProperty
}) => {
  const headerPropertiesString = Object.keys(headerProperties).map(name => {
    const property = {
      name,
      value: headerProperties[name]
    };
    return property;
  }).filter(property => {
    const propertyValidation = validateProperty(property);

    if (!propertyValidation) {
      return false;
    }

    return true;
  }).map(stringifyHeaderProperty).join(";");
  return headerPropertiesString;
};

const stringifyHeaderProperty = ({
  name,
  value
}) => {
  if (typeof value === "string") {
    return `${name}="${value}"`;
  }

  return `${name}=${value}`;
};

const negotiateContentType = (request, availableContentTypes) => {
  const {
    headers = {}
  } = request;
  const requestAcceptHeader = headers.accept;

  if (!requestAcceptHeader) {
    return null;
  }

  const contentTypesAccepted = parseAcceptHeader(requestAcceptHeader);
  return applyContentNegotiation({
    accepteds: contentTypesAccepted,
    availables: availableContentTypes,
    getAcceptanceScore: getContentTypeAcceptanceScore
  });
};

const parseAcceptHeader = acceptHeader => {
  const acceptHeaderObject = parseMultipleHeader(acceptHeader, {
    validateProperty: ({
      name
    }) => {
      // read only q, anything else is ignored
      return name === "q";
    }
  });
  const accepts = [];
  Object.keys(acceptHeaderObject).forEach(key => {
    const {
      q = 1
    } = acceptHeaderObject[key];
    const value = key;
    accepts.push({
      value,
      quality: q
    });
  });
  accepts.sort((a, b) => {
    return b.quality - a.quality;
  });
  return accepts;
};

const getContentTypeAcceptanceScore = ({
  value,
  quality
}, availableContentType) => {
  const [acceptedType, acceptedSubtype] = decomposeContentType(value);
  const [availableType, availableSubtype] = decomposeContentType(availableContentType);
  const typeAccepted = acceptedType === "*" || acceptedType === availableType;
  const subtypeAccepted = acceptedSubtype === "*" || acceptedSubtype === availableSubtype;

  if (typeAccepted && subtypeAccepted) {
    return quality;
  }

  return -1;
};

const decomposeContentType = fullType => {
  const [type, subtype] = fullType.split("/");
  return [type, subtype];
};

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
  const serverTimingHeader = {};
  Object.keys(timing).forEach((key, index) => {
    const name = letters[index] || "zz";
    serverTimingHeader[name] = {
      desc: key,
      dur: timing[key]
    };
  });
  const serverTimingHeaderString = stringifyServerTimingHeader(serverTimingHeader);
  return {
    "server-timing": serverTimingHeaderString
  };
};
const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"];
const stringifyServerTimingHeader = serverTimingHeader => {
  return stringifyMultipleHeader(serverTimingHeader, {
    validateName: validateServerTimingName
  });
}; // (),/:;<=>?@[\]{}" Don't allowed
// Minimal length is one symbol
// Digits, alphabet characters,
// and !#$%&'*+-.^_`|~ are allowed
// https://www.w3.org/TR/2019/WD-server-timing-20190307/#the-server-timing-header-field
// https://tools.ietf.org/html/rfc7230#section-3.2.6

const validateServerTimingName = name => {
  const valid = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/gi.test(name);

  if (!valid) {
    console.warn(`server timing contains invalid symbols`);
    return false;
  }

  return true;
};

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
  "application/manifest+json": {
    extensions: ["webmanifest"]
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
  "text/x-sass": {
    extensions: ["sass"]
  },
  "text/x-scss": {
    extensions: ["scss"]
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

const negotiateContentEncoding = (request, availableEncodings) => {
  const {
    headers = {}
  } = request;
  const requestAcceptEncodingHeader = headers["accept-encoding"];

  if (!requestAcceptEncodingHeader) {
    return null;
  }

  const encodingsAccepted = parseAcceptEncodingHeader(requestAcceptEncodingHeader);
  return applyContentNegotiation({
    accepteds: encodingsAccepted,
    availables: availableEncodings,
    getAcceptanceScore: getEncodingAcceptanceScore
  });
};

const parseAcceptEncodingHeader = acceptEncodingHeaderString => {
  const acceptEncodingHeader = parseMultipleHeader(acceptEncodingHeaderString, {
    validateProperty: ({
      name
    }) => {
      // read only q, anything else is ignored
      return name === "q";
    }
  });
  const encodingsAccepted = [];
  Object.keys(acceptEncodingHeader).forEach(key => {
    const {
      q = 1
    } = acceptEncodingHeader[key];
    const value = key;
    encodingsAccepted.push({
      value,
      quality: q
    });
  });
  encodingsAccepted.sort((a, b) => {
    return b.quality - a.quality;
  });
  return encodingsAccepted;
};

const getEncodingAcceptanceScore = ({
  value,
  quality
}, availableEncoding) => {
  if (value === "*") {
    return quality;
  } // normalize br to brotli


  if (value === "br") value = "brotli";
  if (availableEncoding === "br") availableEncoding = "brotli";

  if (value === availableEncoding) {
    return quality;
  }

  return -1;
};

const {
  readFile
} = fs.promises;
const ETAG_CACHE = new Map();
const ETAG_CACHE_MAX_SIZE = 500;
const serveFile = async (request, {
  rootDirectoryUrl,
  contentTypeMap = jsenvContentTypeMap,
  etagEnabled = false,
  etagCacheDisabled = false,
  mtimeEnabled = false,
  compressionEnabled = false,
  compressionSizeThreshold = 1024,
  cacheControl = etagEnabled || mtimeEnabled ? "private,max-age=0,must-revalidate" : "no-store",
  canReadDirectory = false,
  readableStreamLifetimeInSeconds = 120
} = {}) => {
  try {
    rootDirectoryUrl = util.assertAndNormalizeDirectoryUrl(rootDirectoryUrl);
  } catch (e) {
    const body = `Cannot serve file because rootDirectoryUrl parameter is not a directory url: ${rootDirectoryUrl}`;
    return {
      status: 404,
      headers: {
        "content-type": "text/plain",
        "content-length": Buffer.byteLength(body)
      },
      body
    };
  } // here you might be tempted to add || cacheControl === 'no-cache'
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

  const {
    method,
    ressource
  } = request;

  if (method !== "GET" && method !== "HEAD") {
    return {
      status: 501
    };
  }

  let sourceUrl = util.resolveUrl(ressource.slice(1), rootDirectoryUrl);
  const sourceFileSystemPath = util.urlToFileSystemPath(sourceUrl);

  try {
    const [readStatTiming, sourceStat] = await timeFunction("file service>read file stat", () => fs.statSync(sourceFileSystemPath));

    if (sourceStat.isDirectory()) {
      sourceUrl = util.resolveDirectoryUrl(ressource.slice(1), rootDirectoryUrl);

      if (canReadDirectory === false) {
        return {
          status: 403,
          statusText: "not allowed to read directory",
          timing: readStatTiming
        };
      }

      const [readDirectoryTiming, directoryContentArray] = await timeFunction("file service>read directory", () => cancellation.createOperation({
        cancellationToken: request.cancellationToken,
        start: () => util.readDirectory(sourceUrl)
      }));
      const responseProducers = {
        "application/json": () => {
          const directoryContentJson = JSON.stringify(directoryContentArray);
          return {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": directoryContentJson.length
            },
            body: directoryContentJson,
            timing: { ...readStatTiming,
              ...readDirectoryTiming
            }
          };
        },
        "text/html": () => {
          const directoryAsHtml = `<!DOCTYPE html>
<html>
  <head>
    <title>Directory explorer</title>
    <meta charset="utf-8" />
    <link rel="icon" href="data:," />
  </head>

  <body>
    <h1>Content of directory ${sourceUrl}</h1>
    <ul>
      ${directoryContentArray.map(filename => {
            const fileUrl = util.resolveUrl(filename, sourceUrl);
            const fileUrlRelativeToServer = util.urlToRelativeUrl(fileUrl, rootDirectoryUrl);
            return `<li>
        <a href="/${fileUrlRelativeToServer}">${fileUrlRelativeToServer}</a>
      </li>`;
          }).join(`
      `)}
    </ul>
  </body>
</html>`;
          return {
            status: 200,
            headers: {
              "content-type": "text/html",
              "content-length": Buffer.byteLength(directoryAsHtml)
            },
            body: directoryAsHtml
          };
        }
      };
      const bestContentType = negotiateContentType(request, Object.keys(responseProducers));
      return responseProducers[bestContentType || "application/json"]();
    } // not a file, give up


    if (!sourceStat.isFile()) {
      return {
        status: 404,
        timing: readStatTiming
      };
    }

    const clientCacheResponse = await getClientCacheResponse(request, {
      etagEnabled,
      etagCacheDisabled,
      mtimeEnabled,
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

    let response;

    if (compressionEnabled && sourceStat.size >= compressionSizeThreshold) {
      const compressedResponse = await getCompressedResponse(request, {
        sourceUrl,
        contentTypeMap
      });

      if (compressedResponse) {
        response = compressedResponse;
      }
    }

    if (!response) {
      response = await getRawResponse(request, {
        sourceStat,
        sourceUrl,
        contentTypeMap
      });
    }

    if (response.body) {
      // do not keep readable stream opened on that file
      // otherwise file is kept open forever.
      // moreover it will prevent to unlink the file on windows.
      if (clientCacheResponse.body) {
        response.body.destroy();
      } else if (readableStreamLifetimeInSeconds && readableStreamLifetimeInSeconds !== Infinity) {
        // safe measure, ensure the readable stream gets used in the next ${readableStreamLifetimeInSeconds} otherwise destroys it
        const timeout = setTimeout(() => {
          console.warn(`readable stream on ${sourceUrl} still unused after ${readableStreamLifetimeInSeconds} seconds -> destroying it to release file handle`);
          response.body.destroy();
        }, readableStreamLifetimeInSeconds * 1000);
        onceReadableStreamUsedOrClosed(response.body, () => {
          clearTimeout(timeout);
        });
      }
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
    }, response, clientCacheResponse);
  } catch (e) {
    return convertFileSystemErrorToResponseProperties(e);
  }
};

const getClientCacheResponse = async (request, {
  etagEnabled,
  etagCacheDisabled,
  mtimeEnabled,
  sourceStat,
  sourceUrl
}) => {
  // here you might be tempted to add || headers["cache-control"] === "no-cache"
  // but no-cache means ressource can be cache but must be revalidated (yeah naming is strange)
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#Cacheability
  const {
    headers = {}
  } = request;

  if (headers["cache-control"] === "no-store" || // let's disable it on no-cache too (https://github.com/jsenv/jsenv-server/issues/17)
  headers["cache-control"] === "no-cache") {
    return {
      status: 200
    };
  }

  if (etagEnabled) {
    return getEtagResponse(request, {
      etagCacheDisabled,
      sourceStat,
      sourceUrl
    });
  }

  if (mtimeEnabled) {
    return getMtimeResponse(request, {
      sourceStat
    });
  }

  return {
    status: 200
  };
};

const getEtagResponse = async (request, {
  etagCacheDisabled,
  sourceUrl,
  sourceStat
}) => {
  const [computeEtagTiming, fileContentEtag] = await timeFunction("file service>generate file etag", () => computeEtag(request, {
    etagCacheDisabled,
    sourceUrl,
    sourceStat
  }));
  const {
    headers = {}
  } = request;
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

const computeEtag = async (request, {
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

  const fileContentAsBuffer = await cancellation.createOperation({
    cancellationToken: request.cancellationToken,
    start: () => readFile(util.urlToFileSystemPath(sourceUrl))
  });
  const eTag = util.bufferToEtag(fileContentAsBuffer);

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

const getMtimeResponse = async (request, {
  sourceStat
}) => {
  const {
    headers = {}
  } = request;

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

const getCompressedResponse = async (request, {
  sourceUrl,
  contentTypeMap
}) => {
  const acceptedCompressionFormat = negotiateContentEncoding(request, Object.keys(availableCompressionFormats));

  if (!acceptedCompressionFormat) {
    return null;
  }

  const fileReadableStream = fileUrlToReadableStream(sourceUrl);
  const body = await availableCompressionFormats[acceptedCompressionFormat](fileReadableStream);
  return {
    status: 200,
    headers: {
      "content-type": urlToContentType(sourceUrl, contentTypeMap),
      "content-encoding": acceptedCompressionFormat,
      "vary": "accept-encoding"
    },
    body
  };
};

const fileUrlToReadableStream = fileUrl => {
  return fs.createReadStream(util.urlToFileSystemPath(fileUrl), {
    emitClose: true
  });
};

const availableCompressionFormats = {
  br: async fileReadableStream => {
    const {
      createBrotliCompress
    } = await Promise.resolve().then(function () { return /*#__PURE__*/_interopNamespace(require('zlib')); });
    return fileReadableStream.pipe(createBrotliCompress());
  },
  deflate: async fileReadableStream => {
    const {
      createDeflate
    } = await Promise.resolve().then(function () { return /*#__PURE__*/_interopNamespace(require('zlib')); });
    return fileReadableStream.pipe(createDeflate());
  },
  gzip: async fileReadableStream => {
    const {
      createGzip
    } = await Promise.resolve().then(function () { return /*#__PURE__*/_interopNamespace(require('zlib')); });
    return fileReadableStream.pipe(createGzip());
  }
};

const getRawResponse = async (request, {
  sourceStat,
  sourceUrl,
  contentTypeMap
}) => {
  return {
    status: 200,
    headers: {
      "content-type": urlToContentType(sourceUrl, contentTypeMap),
      "content-length": sourceStat.size
    },
    body: fileUrlToReadableStream(sourceUrl)
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
  cancellationToken = cancellation.createCancellationToken(),
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
    const origin = util.urlToOrigin(url);
    let ressource = util.urlToRessource(url);

    if (process.platform === "win32") {
      ressource = `/${replaceBackSlashesWithSlashes(ressource)}`;
    }

    const request = {
      cancellationToken,
      method: options.method || "GET",
      headers: options.headers || {},
      ressource
    };
    const {
      status,
      statusText,
      headers,
      body
    } = await serveFile(request, {
      rootDirectoryUrl: origin,
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
    return response;
  }

  if (url.startsWith("data:")) {
    const {
      mediaType,
      base64Flag,
      data
    } = parseDataUrl(url);
    const body = base64Flag ? Buffer.from(data, "base64") : Buffer.from(data);
    const response = new Response(body, {
      url,
      status: 200,
      headers: {
        "content-type": mediaType
      }
    });
    return response;
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

  return response;
};

const replaceBackSlashesWithSlashes = string => string.replace(/\\/g, "/");

const parseDataUrl = dataUrl => {
  const afterDataProtocol = dataUrl.slice("data:".length);
  const commaIndex = afterDataProtocol.indexOf(",");
  const beforeComma = afterDataProtocol.slice(0, commaIndex);
  let mediaType;
  let base64Flag;

  if (beforeComma.endsWith(`;base64`)) {
    mediaType = beforeComma.slice(0, -`;base64`.length);
    base64Flag = true;
  } else {
    mediaType = beforeComma;
    base64Flag = false;
  }

  const afterComma = afterDataProtocol.slice(commaIndex + 1);
  return {
    mediaType: mediaType === "" ? "text/plain;charset=US-ASCII" : mediaType,
    base64Flag,
    data: afterComma
  };
};

const listen = ({
  cancellationToken,
  server,
  port,
  portHint,
  ip
}) => {
  return cancellation.createStoppableOperation({
    cancellationToken,
    start: async () => {
      if (portHint) {
        port = await findFreePort(portHint, {
          cancellationToken,
          ip
        });
      }

      return startListening(server, port, ip);
    },
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
  cancellationToken = cancellation.createCancellationToken(),
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

const headersToObject = headers => {
  const headersObject = {};
  headers.forEach((value, name) => {
    headersObject[name] = value;
  });
  return headersObject;
};

const composeService = (...callbacks) => {
  return request => {
    return cancellation.firstOperationMatching({
      array: callbacks,
      start: callback => callback(request),
      predicate: serviceGeneratedResponsePredicate
    });
  };
};
const composeServiceWithTiming = namedServices => {
  return async request => {
    const servicesTiming = {};
    const response = await cancellation.firstOperationMatching({
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
      predicate: serviceGeneratedResponsePredicate
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

const jsenvServerInternalErrorToResponse = (serverInternalError, {
  request,
  sendServerInternalErrorDetails = false
}) => {
  const serverInternalErrorIsAPrimitive = serverInternalError === null || typeof serverInternalError !== "object" && typeof serverInternalError !== "function";
  const dataToSend = serverInternalErrorIsAPrimitive ? {
    code: "VALUE_THROWED",
    value: serverInternalError
  } : {
    code: serverInternalError.code || "UNKNOWN_ERROR",
    ...(sendServerInternalErrorDetails ? {
      stack: serverInternalError.stack,
      ...serverInternalError
    } : {})
  };
  const availableContentTypes = {
    "text/html": () => {
      const renderHtmlForErrorWithoutDetails = () => {
        return `<p>Details not available: to enable them server must be started with sendServerInternalErrorDetails: true.</p>`;
      };

      const renderHtmlForErrorWithDetails = () => {
        if (serverInternalErrorIsAPrimitive) {
          return `<pre>${JSON.stringify(serverInternalError, null, "  ")}</pre>`;
        }

        return `<pre>${serverInternalError.stack}</pre>`;
      };

      const body = `<!DOCTYPE html>
<html>
  <head>
    <title>Internal server error</title>
    <meta charset="utf-8" />
    <link rel="icon" href="data:," />
  </head>

  <body>
    <h1>Internal server error</h1>
    <p>${serverInternalErrorIsAPrimitive ? `Code inside server has thrown a literal.` : `Code inside server has thrown an error.`}</p>
    <details>
      <summary>See internal error details</summary>
      ${sendServerInternalErrorDetails ? renderHtmlForErrorWithDetails() : renderHtmlForErrorWithoutDetails()}
    </details>
  </body>
</html>`;
      return {
        headers: {
          "content-type": "text/html",
          "content-length": Buffer.byteLength(body)
        },
        body
      };
    },
    "application/json": () => {
      const body = JSON.stringify(dataToSend);
      return {
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        },
        body
      };
    }
  };
  const bestContentType = negotiateContentType(request, Object.keys(availableContentTypes));
  return availableContentTypes[bestContentType || "application/json"]();
};

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

const negotiateContentLanguage = (request, availableLanguages) => {
  const {
    headers = {}
  } = request;
  const requestAcceptLanguageHeader = headers["accept-language"];

  if (!requestAcceptLanguageHeader) {
    return null;
  }

  const languagesAccepted = parseAcceptLanguageHeader(requestAcceptLanguageHeader);
  return applyContentNegotiation({
    accepteds: languagesAccepted,
    availables: availableLanguages,
    getAcceptanceScore: getLanguageAcceptanceScore
  });
};

const parseAcceptLanguageHeader = acceptLanguageHeaderString => {
  const acceptLanguageHeader = parseMultipleHeader(acceptLanguageHeaderString, {
    validateProperty: ({
      name
    }) => {
      // read only q, anything else is ignored
      return name === "q";
    }
  });
  const languagesAccepted = [];
  Object.keys(acceptLanguageHeader).forEach(key => {
    const {
      q = 1
    } = acceptLanguageHeader[key];
    const value = key;
    languagesAccepted.push({
      value,
      quality: q
    });
  });
  languagesAccepted.sort((a, b) => {
    return b.quality - a.quality;
  });
  return languagesAccepted;
};

const getLanguageAcceptanceScore = ({
  value,
  quality
}, availableLanguage) => {
  const [acceptedPrimary, acceptedVariant] = decomposeLanguage(value);
  const [availablePrimary, availableVariant] = decomposeLanguage(availableLanguage);
  const primaryAccepted = acceptedPrimary === "*" || acceptedPrimary.toLowerCase() === availablePrimary.toLowerCase();
  const variantAccepted = acceptedVariant === "*" || compareVariant(acceptedVariant, availableVariant);

  if (primaryAccepted && variantAccepted) {
    return quality + 1;
  }

  if (primaryAccepted) {
    return quality;
  }

  return -1;
};

const decomposeLanguage = fullType => {
  const [primary, variant] = fullType.split("-");
  return [primary, variant];
};

const compareVariant = (left, right) => {
  if (left === right) {
    return true;
  }

  if (left && right && left.toLowerCase() === right.toLowerCase()) {
    return true;
  }

  return false;
};

const urlToSearchParamValue = (url, searchParamName) => {
  return new URL(url).searchParams.get(searchParamName);
};

const readRequestBody = (request, {
  as = "string"
} = {}) => {
  return new Promise((resolve, reject) => {
    const bufferArray = [];
    request.body.subscribe({
      error: reject,
      next: buffer => {
        bufferArray.push(buffer);
      },
      complete: () => {
        const bodyAsBuffer = Buffer.concat(bufferArray);

        if (as === "buffer") {
          resolve(bodyAsBuffer);
          return;
        }

        if (as === "string") {
          const bodyAsString = bodyAsBuffer.toString();
          resolve(bodyAsString);
          return;
        }

        if (as === "json") {
          const bodyAsString = bodyAsBuffer.toString();
          const bodyAsJSON = JSON.parse(bodyAsString);
          resolve(bodyAsJSON);
          return;
        }
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

const listenEvent = (objectWithEventEmitter, eventName, callback, {
  once = false
} = {}) => {
  if (once) {
    objectWithEventEmitter.once(eventName, callback);
  } else {
    objectWithEventEmitter.addListener(eventName, callback);
  }

  return () => {
    objectWithEventEmitter.removeListener(eventName, callback);
  };
};

/**

https://stackoverflow.com/a/42019773/2634179

*/
const createPolyglotServer = async ({
  http2 = false,
  http1Allowed = true,
  privateKey,
  certificate
}) => {
  const httpServer = http__default['default'].createServer();
  const tlsServer = await createSecureServer({
    privateKey,
    certificate,
    http2,
    http1Allowed
  });
  const netServer = net__default['default'].createServer({
    allowHalfOpen: false
  });
  listenEvent(netServer, "connection", socket => {
    detectSocketProtocol(socket, protocol => {
      if (protocol === "http") {
        httpServer.emit("connection", socket);
        return;
      }

      if (protocol === "tls") {
        tlsServer.emit("connection", socket);
        return;
      }

      const response = [`HTTP/1.1 400 Bad Request`, `Content-Length: 0`, "", ""].join("\r\n");
      socket.write(response);
      socket.end();
      socket.destroy();
      netServer.emit("clientError", new Error("protocol error, Neither http, nor tls"), socket);
    });
  });
  netServer._httpServer = httpServer;
  netServer._tlsServer = tlsServer;
  return netServer;
}; // The async part is just to lazyly import "http2" or "https"
// so that these module are parsed only if used.

const createSecureServer = async ({
  privateKey,
  certificate,
  http2,
  http1Allowed
}) => {
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
};

const detectSocketProtocol = (socket, protocolDetectedCallback) => {
  let removeOnceReadableListener = () => {};

  const tryToRead = () => {
    const buffer = socket.read(1);

    if (buffer === null) {
      removeOnceReadableListener = socket.once("readable", tryToRead);
      return;
    }

    const firstByte = buffer[0];
    socket.unshift(buffer);

    if (firstByte === 22) {
      protocolDetectedCallback("tls");
      return;
    }

    if (firstByte > 32 && firstByte < 127) {
      protocolDetectedCallback("http");
      return;
    }

    protocolDetectedCallback(null);
  };

  tryToRead();
  return () => {
    removeOnceReadableListener();
  };
};

const trackServerPendingConnections = (nodeServer, {
  http2
}) => {
  if (http2) {
    // see http2.js: we rely on https://nodejs.org/api/http2.html#http2_compatibility_api
    return trackHttp1ServerPendingConnections(nodeServer);
  }

  return trackHttp1ServerPendingConnections(nodeServer);
}; // const trackHttp2ServerPendingSessions = () => {}

const trackHttp1ServerPendingConnections = nodeServer => {
  const pendingConnections = new Set();
  const removeConnectionListener = listenEvent(nodeServer, "connection", connection => {
    pendingConnections.add(connection);
    listenEvent(connection, "close", () => {
      pendingConnections.delete(connection);
    }, {
      once: true
    });
  });

  const stop = async reason => {
    removeConnectionListener();
    const pendingConnectionsArray = Array.from(pendingConnections);
    pendingConnections.clear();
    await Promise.all(pendingConnectionsArray.map(async pendingConnection => {
      await destroyConnection(pendingConnection, reason);
    }));
  };

  return {
    stop
  };
};

const destroyConnection = (connection, reason) => {
  return new Promise((resolve, reject) => {
    connection.destroy(reason, error => {
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
};

const listenRequest = (nodeServer, requestCallback) => {
  if (nodeServer._httpServer) {
    const removeHttpRequestListener = listenEvent(nodeServer._httpServer, "request", requestCallback);
    const removeTlsRequestListener = listenEvent(nodeServer._tlsServer, "request", requestCallback);
    return () => {
      removeHttpRequestListener();
      removeTlsRequestListener();
    };
  }

  return listenEvent(nodeServer, "request", requestCallback);
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
  const removeRequestListener = listenRequest(nodeServer, (nodeRequest, nodeResponse) => {
    const client = {
      nodeRequest,
      nodeResponse
    };
    pendingClients.add(client);
    nodeResponse.once("close", () => {
      pendingClients.delete(client);
    });
  });

  const stop = async ({
    status,
    reason
  }) => {
    removeRequestListener();
    const pendingClientsArray = Array.from(pendingClients);
    pendingClients.clear();
    await Promise.all(pendingClientsArray.map(({
      nodeResponse
    }) => {
      if (nodeResponse.headersSent === false) {
        nodeResponse.writeHead(status, String(reason));
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

// https://github.com/jamestalmage/stream-to-observable/blob/master/index.js
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
    cancellationToken: cancellation.composeCancellationToken(serverCancellationToken, nodeRequestToCancellationToken(nodeRequest)),
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
  } = cancellation.createCancellationSource();
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
      const timer = setTimeout(() => {
        complete();
      });
      return {
        unsubscribe: () => {
          clearTimeout(timer);
        }
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
  const cancellation = cancellationToken.register(() => {
    cancellation.unregister();
    subscription.unsubscribe();
    nodeResponse.destroy();
  });
  nodeResponse.once("close", () => {
    cancellation.unregister(); // close body in case nodeResponse is prematurely closed
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

const checkContentNegotiation = (request, response, {
  warn
}) => {
  const requestAcceptHeader = request.headers.accept;
  const responseContentTypeHeader = response.headers["content-type"];

  if (requestAcceptHeader && responseContentTypeHeader && !negotiateContentType(request, [responseContentTypeHeader])) {
    warn(`response content type is not in the request accepted content types.
--- response content-type header ---
${responseContentTypeHeader}
--- request accept header ---
${requestAcceptHeader}`);
  }

  const requestAcceptLanguageHeader = request.headers["accept-language"];
  const responseContentLanguageHeader = response.headers["content-language"];

  if (requestAcceptLanguageHeader && responseContentLanguageHeader && !negotiateContentLanguage(request, [responseContentLanguageHeader])) {
    warn(`response language is not in the request accepted language.
--- response content-language header ---
${responseContentLanguageHeader}
--- request accept-language header ---
${requestAcceptLanguageHeader}`);
  }

  const requestAcceptEncodingHeader = request.headers["accept-encoding"];
  const responseContentEncodingHeader = response.headers["content-encoding"];

  if (requestAcceptLanguageHeader && responseContentLanguageHeader && !negotiateContentEncoding(request, [responseContentLanguageHeader])) {
    warn(`response encoding is not in the request accepted encoding.
--- response content-encoding header ---
${responseContentEncodingHeader}
--- request accept-encoding header ---
${requestAcceptEncodingHeader}`);
  }
};

const listenServerConnectionError = (nodeServer, connectionErrorCallback, {
  ignoreErrorAfterConnectionIsDestroyed = true
} = {}) => {
  const cleanupSet = new Set();
  const removeConnectionListener = listenEvent(nodeServer, "connection", socket => {
    const removeSocketErrorListener = listenEvent(socket, "error", error => {
      if (ignoreErrorAfterConnectionIsDestroyed && socket.destroyed) {
        return;
      }

      connectionErrorCallback(error, socket);
    });
    const removeOnceSocketCloseListener = listenEvent(socket, "close", () => {
      removeSocketErrorListener();
      cleanupSet.delete(cleanup);
    }, {
      once: true
    });

    const cleanup = () => {
      removeSocketErrorListener();
      removeOnceSocketCloseListener();
    };

    cleanupSet.add(cleanup);
  });
  return () => {
    removeConnectionListener();
    cleanupSet.forEach(cleanup => {
      cleanup();
    });
    cleanupSet.clear();
  };
};

const require$2 = module$1.createRequire(url);

const killPort = require$2("kill-port");

const startServer = async ({
  cancellationToken = cancellation.createCancellationToken(),
  logLevel,
  serverName = "server",
  protocol = "http",
  http2 = false,
  http1Allowed = true,
  redirectHttpToHttps,
  allowHttpRequestOnHttps = false,
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
  sendServerInternalErrorDetails = false,
  serverInternalErrorToResponse = jsenvServerInternalErrorToResponse,
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
  contentNegotiationWarnings = true,
  startedCallback = () => {},
  stoppedCallback = () => {},
  errorIsCancellation = () => false,
  nagle = true
} = {}) => {
  return cancellation.executeAsyncFunction(async () => {
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

    const logger$1 = logger.createLogger({
      logLevel
    });

    if (redirectHttpToHttps === undefined && protocol === "https" && !allowHttpRequestOnHttps) {
      redirectHttpToHttps = true;
    }

    if (redirectHttpToHttps && protocol === "http") {
      logger$1.warn(`redirectHttpToHttps ignored because protocol is http`);
      redirectHttpToHttps = false;
    }

    if (allowHttpRequestOnHttps && redirectHttpToHttps) {
      logger$1.warn(`redirectHttpToHttps ignored because allowHttpRequestOnHttps is enabled`);
      redirectHttpToHttps = false;
    }

    if (allowHttpRequestOnHttps && protocol === "http") {
      logger$1.warn(`allowHttpRequestOnHttps ignored because protocol is http`);
      allowHttpRequestOnHttps = false;
    }

    const internalCancellationSource = cancellation.createCancellationSource();
    const externalCancellationToken = cancellationToken;
    const internalCancellationToken = internalCancellationSource.token;
    const serverCancellationToken = cancellation.composeCancellationToken(externalCancellationToken, internalCancellationToken);

    const onError = error => {
      if (errorIsCancellation(error)) {
        return;
      }

      throw error;
    };

    errorIsCancellation = composePredicate(errorIsCancellation, cancellation.isCancelError);
    const {
      registerCleanupCallback,
      cleanup
    } = createTracker();

    if (stopOnCrash) {
      const unregister = nodeSignals.unadvisedCrashSignal.addCallback(reason => {
        internalCancellationSource.cancel(reason.value);
      });
      registerCleanupCallback(unregister);
    }

    if (stopOnExit) {
      const unregister = nodeSignals.teardownSignal.addCallback(tearDownReason => {
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
      const unregister = nodeSignals.SIGINTSignal.addCallback(() => {
        internalCancellationSource.cancel(STOP_REASON_PROCESS_SIGINT);
      });
      registerCleanupCallback(unregister);
    }

    if (forcePort) {
      await cancellation.createOperation({
        cancellationToken: serverCancellationToken,
        start: () => killPort(port)
      });
    }

    const nodeServer = await createNodeServer({
      protocol,
      redirectHttpToHttps,
      allowHttpRequestOnHttps,
      privateKey,
      certificate,
      http2,
      http1Allowed
    }); // https://nodejs.org/api/net.html#net_server_unref

    if (!keepProcessAlive) {
      nodeServer.unref();
    }

    let status = "starting";
    let stoppedResolve;
    const stoppedPromise = new Promise(resolve => {
      stoppedResolve = resolve;
    });
    const stop = util.memoize(async (reason = STOP_REASON_NOT_SPECIFIED) => {
      status = "stopping";
      errorIsCancellation = composePredicate(errorIsCancellation, error => error === reason);
      errorIsCancellation = composePredicate(errorIsCancellation, error => error && error.code === "ECONNRESET");
      logger$1.info(`${serverName} stopped because ${reason}`);
      await cleanup(reason);
      await stopListening(nodeServer);
      status = "stopped";
      stoppedCallback({
        reason
      });
      stoppedResolve(reason);
    });
    serverCancellationToken.register(stop);
    const startOperation = cancellation.createStoppableOperation({
      cancellationToken: serverCancellationToken,
      start: async () => {
        return listen({
          cancellationToken: serverCancellationToken,
          server: nodeServer,
          port,
          portHint,
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
    const removeConnectionErrorListener = listenServerConnectionError(nodeServer, onError);
    registerCleanupCallback(removeConnectionErrorListener);
    const connectionsTracker = trackServerPendingConnections(nodeServer, {
      http2
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
          location: `${serverOrigin}${nodeRequest.url}`
        });
        nodeResponse.end();
        return;
      }

      const request = nodeRequestToRequest(nodeRequest, {
        serverCancellationToken,
        serverOrigin
      });
      nodeRequest.on("error", error => {
        logger$1.error(`error on request.
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

        if (contentNegotiationWarnings) {
          checkContentNegotiation(request, response, {
            warn: logger$1.warn
          });
        }
      }

      logger$1.info(`${request.method} ${request.origin}${request.ressource}`);

      if (error && cancellation.isCancelError(error) && internalCancellationToken.cancellationRequested) {
        logger$1.info("ignored because server closing");
        nodeResponse.destroy();
        return;
      }

      if (error && cancellation.isCancelError(error) && request.cancellationToken.cancellationRequested) {
        logger$1.info("ignored because request canceled");
        nodeResponse.destroy();
        return;
      }

      if (request.aborted) {
        logger$1.info(`request aborted by client`);
        nodeResponse.destroy();
        return;
      }

      if (request.method !== "HEAD" && response.headers["content-length"] > 0 && response.body === "") {
        logger$1.warn(`content-length header is ${response.headers["content-length"]} but body is empty`);
      }

      if (error) {
        logger$1.error(`internal error while handling request.
--- error stack ---
${error.stack}
--- request ---
${request.method} ${request.origin}${request.ressource}`);
      }

      logger$1.info(`${colorizeResponseStatus(response.status)} ${response.statusText}`);
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

    const removeRequestListener = listenRequest(nodeServer, requestCallback); // ensure we don't try to handle new requests while server is stopping

    registerCleanupCallback(removeRequestListener);
    logger$1.info(`${serverName} started at ${serverOrigin} (${serverOrigins.external})`);
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
          logger: logger$1,
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
          }), await serverInternalErrorToResponse(error, {
            request,
            sendServerInternalErrorDetails
          })),
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

const createNodeServer = async ({
  protocol,
  redirectHttpToHttps,
  allowHttpRequestOnHttps,
  privateKey,
  certificate,
  http2,
  http1Allowed
}) => {
  if (protocol === "http") {
    return http__default['default'].createServer();
  }

  if (redirectHttpToHttps || allowHttpRequestOnHttps) {
    return createPolyglotServer({
      privateKey,
      certificate,
      http2,
      http1Allowed
    });
  }

  const {
    createServer
  } = await Promise.resolve().then(function () { return /*#__PURE__*/_interopNamespace(require('https')); });
  return createServer({
    key: privateKey,
    cert: certificate
  });
};

const statusToStatusText = status => http__default['default'].STATUS_CODES[status] || "not specified"; // https://www.w3.org/TR/cors/
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
      allowedOriginArray.push(util.urlToOrigin(headers.referer));
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
exports.composeResponse = composeResponse;
exports.composeService = composeService;
exports.composeServiceWithTiming = composeServiceWithTiming;
exports.convertFileSystemErrorToResponseProperties = convertFileSystemErrorToResponseProperties;
exports.createSSERoom = createSSERoom;
exports.fetchUrl = fetchUrl;
exports.findFreePort = findFreePort;
exports.headersToObject = headersToObject;
exports.jsenvAccessControlAllowedHeaders = jsenvAccessControlAllowedHeaders;
exports.jsenvAccessControlAllowedMethods = jsenvAccessControlAllowedMethods;
exports.jsenvCertificate = jsenvCertificate;
exports.jsenvPrivateKey = jsenvPrivateKey;
exports.jsenvPublicKey = jsenvPublicKey;
exports.jsenvServerInternalErrorToResponse = jsenvServerInternalErrorToResponse;
exports.negotiateContentEncoding = negotiateContentEncoding;
exports.negotiateContentLanguage = negotiateContentLanguage;
exports.negotiateContentType = negotiateContentType;
exports.readRequestBody = readRequestBody;
exports.serveFile = serveFile;
exports.startServer = startServer;
exports.timeFunction = timeFunction;
exports.timeStart = timeStart;
exports.urlToContentType = urlToContentType;
exports.urlToSearchParamValue = urlToSearchParamValue;

//# sourceMappingURL=main.cjs.map