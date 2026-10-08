export const CANONICAL_ORDER_STATUSES = [
  "RISK_APPROVED",
  "RISK_REJECTED",
  "FILLED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
] as const;

export type CanonicalOrderStatus =
  (typeof CANONICAL_ORDER_STATUSES)[number];

export const LEGACY_ORDER_STATUS_ALIASES = {
  CANCELED:
    "CANCELLED",
} as const;

export type LegacyOrderStatusAlias =
  keyof typeof LEGACY_ORDER_STATUS_ALIASES;

export const LEGACY_OR_UNSUPPORTED_ORDER_STATUSES = [
  "APPROVED",
  "PENDING",
  "REJECTED",
  "CLOSED",
] as const;

export type LegacyOrUnsupportedOrderStatus =
  (typeof LEGACY_OR_UNSUPPORTED_ORDER_STATUSES)[number];

export const TERMINAL_ORDER_STATUSES = [
  "RISK_REJECTED",
  "FILLED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
] as const satisfies
  readonly CanonicalOrderStatus[];

export const ORDER_CREATE_STATUSES = [
  /*
   * Committed-risk BUY creation path.
   */
  "RISK_APPROVED",
  "RISK_REJECTED",

  /*
   * Existing system-executed order paths can insert
   * an already-filled paper order directly.
   */
  "FILLED",
] as const satisfies
  readonly CanonicalOrderStatus[];

export const ORDER_STATE_TRANSITIONS:
  Readonly<
    Record<
      CanonicalOrderStatus,
      readonly CanonicalOrderStatus[]
    >
  > = {
  /*
   * Current production BUY lifecycle proven by:
   * - committed-risk reservation creation
   * - fill RPC
   * - expiry/reconciliation layer
   */
  RISK_APPROVED: [
    "FILLED",
    "EXPIRED",
  ],

  /*
   * Terminal states do not transition further.
   * Same-state retries are handled separately as
   * idempotent no-ops by validateOrderTransition().
   */
  RISK_REJECTED: [],
  FILLED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
};

export const RESERVED_FUTURE_TRANSITIONS = {
  /*
   * These states are intentionally recognized but are NOT
   * enabled as transitions in V1 until their production
   * writers are explicitly implemented/audited.
   */
  RISK_APPROVED: [
    "CANCELLED",
    "FAILED",
  ],
} as const;

const canonicalSet =
  new Set<string>(
    CANONICAL_ORDER_STATUSES,
  );

const terminalSet =
  new Set<string>(
    TERMINAL_ORDER_STATUSES,
  );

const createSet =
  new Set<string>(
    ORDER_CREATE_STATUSES,
  );

const unsupportedSet =
  new Set<string>(
    LEGACY_OR_UNSUPPORTED_ORDER_STATUSES,
  );

export type OrderStatusClassification =
  | {
      kind:
        "CANONICAL";
      input:
        string;
      canonical:
        CanonicalOrderStatus;
      legacyAlias:
        false;
    }
  | {
      kind:
        "LEGACY_ALIAS";
      input:
        string;
      canonical:
        CanonicalOrderStatus;
      legacyAlias:
        true;
    }
  | {
      kind:
        "LEGACY_UNSUPPORTED";
      input:
        string;
      canonical:
        null;
      legacyAlias:
        false;
    }
  | {
      kind:
        "UNKNOWN";
      input:
        string;
      canonical:
        null;
      legacyAlias:
        false;
    };

export function classifyOrderStatus(
  value: unknown,
): OrderStatusClassification {
  const input =
    typeof value ===
    "string"
      ? value
          .trim()
          .toUpperCase()
      : "";

  if (
    canonicalSet.has(
      input,
    )
  ) {
    return {
      kind:
        "CANONICAL",
      input,
      canonical:
        input as CanonicalOrderStatus,
      legacyAlias:
        false,
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(
      LEGACY_ORDER_STATUS_ALIASES,
      input,
    )
  ) {
    return {
      kind:
        "LEGACY_ALIAS",
      input,
      canonical:
        LEGACY_ORDER_STATUS_ALIASES[
          input as LegacyOrderStatusAlias
        ],
      legacyAlias:
        true,
    };
  }

  if (
    unsupportedSet.has(
      input,
    )
  ) {
    return {
      kind:
        "LEGACY_UNSUPPORTED",
      input,
      canonical:
        null,
      legacyAlias:
        false,
    };
  }

  return {
    kind:
      "UNKNOWN",
    input,
    canonical:
      null,
    legacyAlias:
      false,
  };
}

export function normalizeOrderStatus(
  value: unknown,
): CanonicalOrderStatus | null {
  return classifyOrderStatus(
    value,
  ).canonical;
}

export function isTerminalOrderStatus(
  value: unknown,
) {
  const normalized =
    normalizeOrderStatus(
      value,
    );

  return (
    normalized !== null &&
    terminalSet.has(
      normalized,
    )
  );
}

export type OrderStateValidation =
  | {
      allowed:
        true;
      idempotent:
        boolean;
      from:
        CanonicalOrderStatus | "__CREATE__";
      to:
        CanonicalOrderStatus;
      reason:
        "CREATE_ALLOWED" |
        "TRANSITION_ALLOWED" |
        "IDEMPOTENT_NOOP";
    }
  | {
      allowed:
        false;
      idempotent:
        false;
      from:
        CanonicalOrderStatus | "__CREATE__" | null;
      to:
        CanonicalOrderStatus | null;
      reason:
        "UNSUPPORTED_FROM_STATUS" |
        "UNSUPPORTED_TO_STATUS" |
        "CREATE_STATUS_NOT_ALLOWED" |
        "TERMINAL_STATE_CANNOT_TRANSITION" |
        "TRANSITION_NOT_ALLOWED";
    };

export function validateOrderTransition(
  fromValue:
    unknown,
  toValue:
    unknown,
): OrderStateValidation {
  const to =
    normalizeOrderStatus(
      toValue,
    );

  if (!to) {
    return {
      allowed:
        false,
      idempotent:
        false,
      from:
        null,
      to:
        null,
      reason:
        "UNSUPPORTED_TO_STATUS",
    };
  }

  if (
    fromValue ===
    "__CREATE__"
  ) {
    if (
      createSet.has(
        to,
      )
    ) {
      return {
        allowed:
          true,
        idempotent:
          false,
        from:
          "__CREATE__",
        to,
        reason:
          "CREATE_ALLOWED",
      };
    }

    return {
      allowed:
        false,
      idempotent:
        false,
      from:
        "__CREATE__",
      to,
      reason:
        "CREATE_STATUS_NOT_ALLOWED",
    };
  }

  const from =
    normalizeOrderStatus(
      fromValue,
    );

  if (!from) {
    return {
      allowed:
        false,
      idempotent:
        false,
      from:
        null,
      to,
      reason:
        "UNSUPPORTED_FROM_STATUS",
    };
  }

  if (
    from === to
  ) {
    return {
      allowed:
        true,
      idempotent:
        true,
      from,
      to,
      reason:
        "IDEMPOTENT_NOOP",
    };
  }

  if (
    terminalSet.has(
      from,
    )
  ) {
    return {
      allowed:
        false,
      idempotent:
        false,
      from,
      to,
      reason:
        "TERMINAL_STATE_CANNOT_TRANSITION",
    };
  }

  const allowedTargets =
    ORDER_STATE_TRANSITIONS[
      from
    ];

  if (
    allowedTargets.includes(
      to,
    )
  ) {
    return {
      allowed:
        true,
      idempotent:
        false,
      from,
      to,
      reason:
        "TRANSITION_ALLOWED",
    };
  }

  return {
    allowed:
      false,
    idempotent:
      false,
    from,
    to,
    reason:
      "TRANSITION_NOT_ALLOWED",
  };
}

export const ORDER_STATE_MACHINE_V1 = {
  version:
    "ALPHA_V3_ORDER_STATE_MACHINE_V1",

  enforcementMode:
    "CONTRACT_ONLY",

  canonicalStatuses:
    CANONICAL_ORDER_STATUSES,

  terminalStatuses:
    TERMINAL_ORDER_STATUSES,

  createStatuses:
    ORDER_CREATE_STATUSES,

  transitions:
    ORDER_STATE_TRANSITIONS,

  legacyAliases:
    LEGACY_ORDER_STATUS_ALIASES,

  legacyOrUnsupportedStatuses:
    LEGACY_OR_UNSUPPORTED_ORDER_STATUSES,

  reservedFutureTransitions:
    RESERVED_FUTURE_TRANSITIONS,

  invariants: [
    "TERMINAL_STATES_NEVER_TRANSITION_TO_A_DIFFERENT_STATE",
    "SAME_STATE_RETRY_IS_IDEMPOTENT_NOOP",
    "CANCELED_READS_AS_CANCELLED_BUT_NEW_WRITES_USE_CANCELLED",
    "APPROVED_PENDING_REJECTED_CLOSED_ARE_NOT_CANONICAL_V1_ORDER_WRITES",
    "RISK_APPROVED_CAN_ONLY_FILL_OR_EXPIRE_IN_V1",
    "CANCELLED_AND_FAILED_ARE_RECOGNIZED_BUT_NOT_REACHABLE_UNTIL_WRITERS_ARE_AUDITED",
  ],
} as const;
