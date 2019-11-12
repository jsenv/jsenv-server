const createReason = (reasonString) => {
  return {
    toString: () => reasonString,
  }
}

export const STOP_REASON_INTERNAL_ERROR = createReason("internal error")
export const STOP_REASON_PROCESS_SIGINT = createReason("process sigint")
export const STOP_REASON_PROCESS_BEFORE_EXIT = createReason("process before exit")
export const STOP_REASON_PROCESS_HANGUP_OR_DEATH = createReason("process hangup or death")
export const STOP_REASON_PROCESS_DEATH = createReason("process death")
export const STOP_REASON_PROCESS_EXIT = createReason("process exit")
export const STOP_REASON_NOT_SPECIFIED = createReason("not specified")
