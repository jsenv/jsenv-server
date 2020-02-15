'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopNamespace(e) {
  if (e && e.__esModule) { return e; } else {
    var n = {};
    if (e) {
      Object.keys(e).forEach(function (k) {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () {
            return e[k];
          }
        });
      });
    }
    n['default'] = e;
    return n;
  }
}

var module$1 = require('module');
var fs = require('fs');
var url$1 = require('url');
var crypto = require('crypto');
var path = require('path');
var util = require('util');
var net = require('net');
var http = require('http');
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

const catchCancellation = asyncFn => {
  return asyncFn().catch(error => {
    if (isCancelError(error)) {
      // it means consume of the function will resolve with a cancelError
      // but when you cancel it means you're not interested in the result anymore
      // thanks to this it avoid unhandledRejection
      return error;
    }

    throw error;
  });
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

const jsenvContentTypeMap = {
  "application/javascript": {
    extensions: ["js", "cjs", "mjs", "ts", "jsx"]
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

const {
  readFile
} = fs.promises;
const serveFile = async (source, {
  cancellationToken = createCancellationToken(),
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
  const clientCacheDisabled = headers["cache-control"] === "no-cache";

  try {
    const cacheWithMtime = !clientCacheDisabled && cacheStrategy === "mtime";
    const cacheWithETag = !clientCacheDisabled && cacheStrategy === "etag";
    const cachedDisabled = clientCacheDisabled || cacheStrategy === "none";
    const sourceStat = await createOperation({
      cancellationToken,
      start: () => readFileSystemNodeStat(sourceUrl)
    });

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

      const directoryContentArray = await createOperation({
        cancellationToken,
        start: () => readDirectory(sourceUrl)
      });
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
      const fileContentAsBuffer = await createOperation({
        cancellationToken,
        start: () => readFile(urlToFileSystemPath(sourceUrl))
      });
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

const require$1 = module$1.createRequire(url);

const nodeFetch = require$1("node-fetch");

const AbortController = require$1("abort-controller");

const {
  Response
} = nodeFetch;
const fetchUrl = async (url, {
  cancellationToken = createCancellationToken(),
  simplified = false,
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
  } // https://github.com/bitinn/node-fetch#request-cancellation-with-abortsignal


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
      ...options
    });
  } catch (e) {
    if (cancelError && e.name === "AbortError") {
      throw cancelError;
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

const urlToSearchParamValue = (url, searchParamName) => {
  return new URL(url).searchParams.get(searchParamName);
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
      } = await new Promise(function (resolve) { resolve(_interopNamespace(require('http2'))); });
      return createServer();
    }

    const {
      createServer
    } = await new Promise(function (resolve) { resolve(_interopNamespace(require('http'))); });
    return createServer();
  }

  if (protocol === "https") {
    if (http2) {
      const {
        createSecureServer
      } = await new Promise(function (resolve) { resolve(_interopNamespace(require('http2'))); });
      return createSecureServer({
        key: privateKey,
        cert: certificate,
        allowHTTP1: http1Allowed
      });
    }

    const {
      createServer
    } = await new Promise(function (resolve) { resolve(_interopNamespace(require('https'))); });
    return createServer({
      key: privateKey,
      cert: certificate
    });
  }

  throw new Error(`unsupported protocol ${protocol}`);
};

const trackServerPendingConnections = (nodeServer, {
  onConnectionError
}) => {
  const pendingConnections = new Set();

  const connectionListener = connection => {
    connection.on("close", () => {
      pendingConnections.delete(connection);
    });
    connection.on("error", onConnectionError);
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

const trackServerPendingRequests = nodeServer => {
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
      }

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
      // should we do nodeStream.resume() in case the stream was paused
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
  return Object.freeze({
    // the node request is considered as cancelled if client cancels or server cancels.
    // in case of server cancellation from a client perspective request is not cancelled
    // because client still wants a response. But from a server perspective the production
    // of a response for this request is cancelled
    cancellationToken: composeCancellationToken(serverCancellationToken, nodeRequestToCancellationToken(nodeRequest)),
    origin: serverOrigin,
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
  ignoreBody,
  ignoreStatusTest
} = {}) => {
  const nodeHeaders = headersToNodeHeaders(headers); // nodejs strange signature for writeHead force this
  // https://nodejs.org/api/http.html#http_response_writehead_statuscode_statusmessage_headers

  if (statusText === undefined || ignoreStatusTest) {
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

const STOP_REASON_INTERNAL_ERROR = createReason("Internal error");
const STOP_REASON_PROCESS_SIGHUP = createReason("process SIGHUP");
const STOP_REASON_PROCESS_SIGTERM = createReason("process SIGTERM");
const STOP_REASON_PROCESS_SIGINT = createReason("process SIGINT");
const STOP_REASON_PROCESS_BEFORE_EXIT = createReason("process before exit");
const STOP_REASON_PROCESS_EXIT = createReason("process exit");
const STOP_REASON_NOT_SPECIFIED = createReason("not specified");

const require$2 = module$1.createRequire(url);

const killPort = require$2("kill-port");

const startServer = async ({
  cancellationToken = createCancellationToken(),
  logLevel,
  serverName = "server",
  protocol = "http",
  http2 = protocol === "https",
  http1Allowed = true,
  ip = "127.0.0.1",
  port = 0,
  // assign a random available port
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
  stoppedCallback = () => {},
  errorIsCancellation = () => false
} = {}) => {
  return catchCancellation(async () => {
    if (port === 0 && forcePort) {
      throw new Error(`no need to pass forcePort when port is 0`);
    }

    if (protocol !== "http" && protocol !== "https") {
      throw new Error(`protocol must be http or https, got ${protocol}`);
    } // https://github.com/nodejs/node/issues/14900


    if (ip === "0.0.0.0" && process.platform === "win32") {
      throw new Error(`listening ${ip} not available on window`);
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

    const internalCancellationSource = createCancellationSource();
    const externalCancellationToken = cancellationToken;
    const internalCancellationToken = internalCancellationSource.token;
    const serverCancellationToken = composeCancellationToken(externalCancellationToken, internalCancellationToken);
    const logger = createLogger({
      logLevel
    });

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
      start: () => listen({
        cancellationToken: serverCancellationToken,
        server: nodeServer,
        port,
        ip
      }),
      stop: (_, reason) => stop(reason)
    });
    port = await startOperation;
    status = "opened";
    const serverOrigin = originAsString({
      protocol,
      ip,
      port
    });
    const connectionsTracker = trackServerPendingConnections(nodeServer, {
      onConnectionError: onError
    }); // opened connection must be shutdown before the close event is emitted

    registerCleanupCallback(connectionsTracker.stop);
    const pendingRequestsTracker = trackServerPendingRequests(nodeServer); // ensure pending requests got a response from the server

    registerCleanupCallback(reason => {
      pendingRequestsTracker.stop({
        status: reason === STOP_REASON_INTERNAL_ERROR ? 500 : 503,
        reason
      });
    });

    const requestCallback = async (nodeRequest, nodeResponse) => {
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
      const response = await getResponse(request);
      populateNodeResponse(nodeResponse, response, {
        ignoreBody: request.method === "HEAD",
        // https://github.com/nodejs/node/blob/79296dc2d02c0b9872bbfcbb89148ea036a546d0/lib/internal/http2/compat.js#L97
        ignoreStatusTest: Boolean(nodeRequest.stream)
      });
    };

    nodeServer.on("request", requestCallback); // ensure we don't try to handle new requests while server is stopping

    registerCleanupCallback(() => {
      nodeServer.removeListener("request", requestCallback);
    });
    logger.info(`${serverName} started at ${serverOrigin}`);
    startedCallback({
      origin: serverOrigin
    });
    const corsEnabled = accessControlAllowRequestOrigin || accessControlAllowedOrigins.length; // here we check access control options to throw or warn if we find strange values

    const getResponse = async request => {
      const {
        response,
        error
      } = await generateResponseDescription(request);

      if (request.method !== "HEAD" && response.headers["content-length"] > 0 && response.body === "") {
        logger.error(createContentLengthMismatchError(`content-length header is ${response.headers["content-length"]} but body is empty`));
      }

      logger.info(`${request.method} ${request.origin}${request.ressource}`);

      if (error) {
        logger.error(`internal error while handling request.
--- error stack ---
${error.stack}
--- request ---
${request.method} ${request.origin}${request.ressource}`);
      }

      logger.info(`${colorizeResponseStatus(response.status)} ${response.statusText}`);

      if (stopOnInternalError && // stopOnInternalError stops server only if requestToResponse generated
      // a non controlled error (internal error).
      // if requestToResponse gracefully produced a 500 response (it did not throw)
      // then we can assume we are still in control of what we are doing
      error) {
        // il faudrais pouvoir stop que les autres response ?
        setTimeout(() => stop(STOP_REASON_INTERNAL_ERROR));
      }

      return response;
    };

    const generateResponseDescription = async request => {
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
          response: responsePropertiesToResponse(responseProperties || {})
        };
      } catch (error) {
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
exports.jsenvAccessControlAllowedHeaders = jsenvAccessControlAllowedHeaders;
exports.jsenvAccessControlAllowedMethods = jsenvAccessControlAllowedMethods;
exports.jsenvCertificate = jsenvCertificate;
exports.jsenvPrivateKey = jsenvPrivateKey;
exports.jsenvPublicKey = jsenvPublicKey;
exports.serveFile = serveFile;
exports.startServer = startServer;
exports.urlToContentType = urlToContentType;
exports.urlToSearchParamValue = urlToSearchParamValue;
//# sourceMappingURL=main.cjs.map
