const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const migrationRel =
  "supabase/migrations/20261008001400_order_state_machine_strict_activation_v1.sql";

const staticRel =
  "scripts/alpha-v3-order-state-strict-activation-v1-static-verify.cjs";

const dbVerifyRel =
  "scripts/alpha-v3-order-state-strict-activation-v1-db-verify.cjs";

const migrationFile =
  path.resolve(
    root,
    migrationRel
  );

fs.mkdirSync(
  path.dirname(
    migrationFile
  ),
  {
    recursive:
      true
  }
);

if (
  fs.existsSync(
    migrationFile
  )
) {
  const backup =
    `${migrationFile}.before-v1.bak`;

  if (
    !fs.existsSync(
      backup
    )
  ) {
    fs.copyFileSync(
      migrationFile,
      backup
    );
  }
}

fs.writeFileSync(
  migrationFile,
  "begin;\n\ndo $$\ndeclare\n  v_mode text;\n  v_version text;\n  v_total_orders bigint;\n  v_approved_orders bigint;\n  v_active_reservations bigint;\n  v_positions bigint;\n  v_invalid_audit bigint;\nbegin\n  select\n    c.mode,\n    c.version\n  into\n    v_mode,\n    v_version\n  from public.paper_order_state_machine_config c\n  where c.id = 1\n  for update;\n\n  if v_mode is distinct from 'AUDIT' then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          format(\n            'ORDER_STATE_STRICT_ACTIVATION_REJECTED expected_mode=AUDIT actual_mode=%s',\n            coalesce(v_mode, '__NULL__')\n          );\n  end if;\n\n  if\n    v_version is distinct from\n      'ALPHA_V3_ORDER_STATE_MACHINE_V1'\n  then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          format(\n            'ORDER_STATE_STRICT_ACTIVATION_REJECTED expected_version=ALPHA_V3_ORDER_STATE_MACHINE_V1 actual_version=%s',\n            coalesce(v_version, '__NULL__')\n          );\n  end if;\n\n  select count(*)\n  into v_total_orders\n  from public.paper_order_requests;\n\n  if v_total_orders <> 0 then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          format(\n            'ORDER_STATE_STRICT_ACTIVATION_REJECTED paper_order_count=%s',\n            v_total_orders\n          );\n  end if;\n\n  select count(*)\n  into v_approved_orders\n  from public.paper_order_requests\n  where status = 'RISK_APPROVED';\n\n  if v_approved_orders <> 0 then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          format(\n            'ORDER_STATE_STRICT_ACTIVATION_REJECTED risk_approved_count=%s',\n            v_approved_orders\n          );\n  end if;\n\n  select count(*)\n  into v_active_reservations\n  from public.paper_order_requests\n  where\n    reserved_risk_amount > 0\n    and\n    reserved_risk_released_at is null;\n\n  if v_active_reservations <> 0 then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          format(\n            'ORDER_STATE_STRICT_ACTIVATION_REJECTED active_reservation_count=%s',\n            v_active_reservations\n          );\n  end if;\n\n  select count(*)\n  into v_positions\n  from public.paper_positions;\n\n  if v_positions <> 0 then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          format(\n            'ORDER_STATE_STRICT_ACTIVATION_REJECTED paper_position_count=%s',\n            v_positions\n          );\n  end if;\n\n  select count(*)\n  into v_invalid_audit\n  from public.paper_order_state_transition_audit\n  where allowed = false;\n\n  if v_invalid_audit <> 0 then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          format(\n            'ORDER_STATE_STRICT_ACTIVATION_REJECTED invalid_audit_count=%s',\n            v_invalid_audit\n          );\n  end if;\n\n  if not exists (\n    select 1\n    from pg_trigger t\n    join pg_class c\n      on c.oid = t.tgrelid\n    join pg_namespace n\n      on n.oid = c.relnamespace\n    where\n      n.nspname = 'public'\n      and\n      c.relname = 'paper_order_requests'\n      and\n      t.tgname =\n        'zz_paper_order_state_transition_audit_v1'\n      and\n      not t.tgisinternal\n  ) then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          'ORDER_STATE_STRICT_ACTIVATION_REJECTED audit_trigger_missing';\n  end if;\n\n  update public.paper_order_state_machine_config\n  set\n    mode = 'STRICT',\n    version =\n      'ALPHA_V3_ORDER_STATE_MACHINE_V1',\n    updated_at = now()\n  where id = 1;\n\n  if not found then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          'ORDER_STATE_STRICT_ACTIVATION_REJECTED config_row_missing';\n  end if;\nend;\n$$;\n\ncomment on table\n  public.paper_order_state_machine_config\nis\n  'Alpha V3 order state machine enforcement mode. STRICT activated after clean AUDIT compatibility and preactivation checks.';\n\ncommit;\n",
  "utf8"
);

fs.mkdirSync(
  path.resolve(
    root,
    "scripts"
  ),
  {
    recursive:
      true
  }
);

fs.writeFileSync(
  path.resolve(
    root,
    staticRel
  ),
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst file = path.resolve(\n  root,\n  \"supabase/migrations/20261008001400_order_state_machine_strict_activation_v1.sql\"\n);\n\nif (!fs.existsSync(file)) {\n  throw new Error(\n    \"STRICT_ACTIVATION_MIGRATION_NOT_FOUND\"\n  );\n}\n\nconst text =\n  fs.readFileSync(\n    file,\n    \"utf8\"\n  );\n\nconst checks = {\n  transactionPresent:\n    /^\\s*begin;/im.test(text) &&\n    /\\bcommit;/im.test(text),\n\n  requiresAuditMode:\n    /v_mode\\s+is\\s+distinct\\s+from\\s+'AUDIT'/im.test(\n      text\n    ),\n\n  requiresV1Version:\n    text.includes(\n      \"ALPHA_V3_ORDER_STATE_MACHINE_V1\"\n    ),\n\n  requiresZeroOrders:\n    /from\\s+public\\.paper_order_requests[\\s\\S]{0,250}?v_total_orders\\s*<>\\s*0/im.test(\n      text\n    ),\n\n  requiresZeroRiskApproved:\n    /status\\s*=\\s*'RISK_APPROVED'[\\s\\S]{0,250}?v_approved_orders\\s*<>\\s*0/im.test(\n      text\n    ),\n\n  requiresZeroActiveReservations:\n    /reserved_risk_amount\\s*>\\s*0[\\s\\S]{0,250}?reserved_risk_released_at\\s+is\\s+null/im.test(\n      text\n    ),\n\n  requiresZeroPositions:\n    /from\\s+public\\.paper_positions[\\s\\S]{0,250}?v_positions\\s*<>\\s*0/im.test(\n      text\n    ),\n\n  requiresZeroInvalidAudit:\n    /paper_order_state_transition_audit[\\s\\S]{0,200}?allowed\\s*=\\s*false/im.test(\n      text\n    ),\n\n  requiresTriggerPresence:\n    text.includes(\n      \"zz_paper_order_state_transition_audit_v1\"\n    ) &&\n    text.includes(\n      \"pg_trigger\"\n    ),\n\n  activatesStrict:\n    /update\\s+public\\.paper_order_state_machine_config[\\s\\S]{0,300}?mode\\s*=\\s*'STRICT'/im.test(\n      text\n    ),\n\n  noOrderWrites:\n    !/insert\\s+into\\s+public\\.paper_order_requests/im.test(\n      text\n    ) &&\n    !/update\\s+public\\.paper_order_requests/im.test(\n      text\n    ) &&\n    !/delete\\s+from\\s+public\\.paper_order_requests/im.test(\n      text\n    ),\n\n  noPositionWrites:\n    !/insert\\s+into\\s+public\\.paper_positions/im.test(\n      text\n    ) &&\n    !/update\\s+public\\.paper_positions/im.test(\n      text\n    ) &&\n    !/delete\\s+from\\s+public\\.paper_positions/im.test(\n      text\n    )\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([key]) =>\n        key\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      targetMode:\n        \"STRICT\",\n\n      safety: {\n        migrationOnlyChangesStateMachineConfig:\n          true,\n\n        paperOrderWrites:\n          0,\n\n        positionWrites:\n          0,\n\n        testOrdersCreated:\n          0\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"APPLY_STRICT_ACTIVATION_MIGRATION\"\n          : \"REVIEW_STRICT_ACTIVATION_MIGRATION\"\n    },\n    null,\n    2\n  )\n);\n\nif (failed.length > 0) {\n  process.exitCode =\n    2;\n}\n",
  "utf8"
);

fs.writeFileSync(
  path.resolve(
    root,
    dbVerifyRel
  ),
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nfunction parseEnvFile(file) {\n  const env = {};\n\n  if (!fs.existsSync(file)) {\n    return env;\n  }\n\n  for (\n    const rawLine of\n      fs\n        .readFileSync(\n          file,\n          \"utf8\"\n        )\n        .split(/\\r?\\n/)\n  ) {\n    const line =\n      rawLine.trim();\n\n    if (\n      !line ||\n      line.startsWith(\"#\")\n    ) {\n      continue;\n    }\n\n    const index =\n      line.indexOf(\"=\");\n\n    if (index <= 0) {\n      continue;\n    }\n\n    const key =\n      line\n        .slice(0, index)\n        .trim();\n\n    let value =\n      line\n        .slice(index + 1)\n        .trim();\n\n    if (\n      (\n        value.startsWith('\"') &&\n        value.endsWith('\"')\n      ) ||\n      (\n        value.startsWith(\"'\") &&\n        value.endsWith(\"'\")\n      )\n    ) {\n      value =\n        value.slice(\n          1,\n          -1\n        );\n    }\n\n    env[key] =\n      value;\n  }\n\n  return env;\n}\n\nconst env = {\n  ...parseEnvFile(\n    path.resolve(\n      root,\n      \".env.local\"\n    )\n  ),\n  ...process.env\n};\n\nconst supabaseUrl =\n  String(\n    env.NEXT_PUBLIC_SUPABASE_URL ||\n    env.SUPABASE_URL ||\n    \"\"\n  )\n    .trim()\n    .replace(/\\/+$/, \"\");\n\nconst serviceRoleKey =\n  String(\n    env.SUPABASE_SERVICE_ROLE_KEY ||\n    env.SUPABASE_SERVICE_KEY ||\n    \"\"\n  ).trim();\n\nif (\n  !supabaseUrl ||\n  !serviceRoleKey\n) {\n  throw new Error(\n    \"SUPABASE_SERVICE_ROLE_CONFIG_MISSING\"\n  );\n}\n\nasync function parseResponse(\n  response\n) {\n  const text =\n    await response.text();\n\n  try {\n    return text\n      ? JSON.parse(text)\n      : null;\n  } catch {\n    return {\n      raw:\n        text\n    };\n  }\n}\n\nasync function get(\n  pathname,\n  preferCount = false\n) {\n  const headers = {\n    apikey:\n      serviceRoleKey,\n\n    authorization:\n      \"Bearer \" +\n      serviceRoleKey\n  };\n\n  if (preferCount) {\n    headers.prefer =\n      \"count=exact\";\n\n    headers.range =\n      \"0-0\";\n  }\n\n  const response =\n    await fetch(\n      supabaseUrl +\n      pathname,\n      {\n        method:\n          \"GET\",\n\n        headers,\n\n        cache:\n          \"no-store\"\n      }\n    );\n\n  const payload =\n    await parseResponse(\n      response\n    );\n\n  let count =\n    null;\n\n  if (preferCount) {\n    const contentRange =\n      response.headers.get(\n        \"content-range\"\n      );\n\n    if (contentRange) {\n      const match =\n        contentRange.match(\n          /\\/(\\d+|\\*)$/\n        );\n\n      if (\n        match &&\n        match[1] !== \"*\"\n      ) {\n        count =\n          Number(\n            match[1]\n          );\n      }\n    }\n  }\n\n  return {\n    ok:\n      response.ok,\n\n    status:\n      response.status,\n\n    count,\n\n    payload:\n      response.ok\n        ? payload\n        : null,\n\n    error:\n      response.ok\n        ? null\n        : payload\n  };\n}\n\nasync function rpc(\n  oldStatus,\n  newStatus,\n  isInsert\n) {\n  const response =\n    await fetch(\n      supabaseUrl +\n      \"/rest/v1/rpc/validate_paper_order_state_transition_v1\",\n      {\n        method:\n          \"POST\",\n\n        headers: {\n          apikey:\n            serviceRoleKey,\n\n          authorization:\n            \"Bearer \" +\n            serviceRoleKey,\n\n          \"content-type\":\n            \"application/json\"\n        },\n\n        body:\n          JSON.stringify({\n            p_old_status:\n              oldStatus,\n\n            p_new_status:\n              newStatus,\n\n            p_is_insert:\n              isInsert\n          }),\n\n        cache:\n          \"no-store\"\n      }\n    );\n\n  return {\n    ok:\n      response.ok,\n\n    status:\n      response.status,\n\n    payload:\n      await parseResponse(\n        response\n      )\n  };\n}\n\nasync function main() {\n  const [\n    config,\n    orders,\n    approved,\n    reservations,\n    positions,\n    invalidAudit\n  ] =\n    await Promise.all([\n      get(\n        \"/rest/v1/paper_order_state_machine_config\" +\n        \"?select=id,mode,version,updated_at\" +\n        \"&id=eq.1\" +\n        \"&limit=1\"\n      ),\n\n      get(\n        \"/rest/v1/paper_order_requests?select=id\",\n        true\n      ),\n\n      get(\n        \"/rest/v1/paper_order_requests\" +\n        \"?select=id&status=eq.RISK_APPROVED\",\n        true\n      ),\n\n      get(\n        \"/rest/v1/paper_order_requests\" +\n        \"?select=id\" +\n        \"&reserved_risk_amount=gt.0\" +\n        \"&reserved_risk_released_at=is.null\",\n        true\n      ),\n\n      get(\n        \"/rest/v1/paper_positions?select=id\",\n        true\n      ),\n\n      get(\n        \"/rest/v1/paper_order_state_transition_audit\" +\n        \"?select=id&allowed=eq.false\",\n        true\n      )\n    ]);\n\n  const configRow =\n    config.ok &&\n    Array.isArray(\n      config.payload\n    )\n      ? config.payload[0] ??\n        null\n      : null;\n\n  const validatorChecks = [\n    {\n      name:\n        \"RISK_APPROVED_TO_FILLED_ALLOWED\",\n\n      result:\n        await rpc(\n          \"RISK_APPROVED\",\n          \"FILLED\",\n          false\n        ),\n\n      expectedAllowed:\n        true,\n\n      expectedReason:\n        \"TRANSITION_ALLOWED\"\n    },\n\n    {\n      name:\n        \"RISK_APPROVED_TO_EXPIRED_ALLOWED\",\n\n      result:\n        await rpc(\n          \"RISK_APPROVED\",\n          \"EXPIRED\",\n          false\n        ),\n\n      expectedAllowed:\n        true,\n\n      expectedReason:\n        \"TRANSITION_ALLOWED\"\n    },\n\n    {\n      name:\n        \"RISK_APPROVED_TO_CANCELLED_REJECTED\",\n\n      result:\n        await rpc(\n          \"RISK_APPROVED\",\n          \"CANCELLED\",\n          false\n        ),\n\n      expectedAllowed:\n        false,\n\n      expectedReason:\n        \"TRANSITION_NOT_ALLOWED\"\n    },\n\n    {\n      name:\n        \"FILLED_TO_EXPIRED_REJECTED\",\n\n      result:\n        await rpc(\n          \"FILLED\",\n          \"EXPIRED\",\n          false\n        ),\n\n      expectedAllowed:\n        false,\n\n      expectedReason:\n        \"TERMINAL_STATE_CANNOT_TRANSITION\"\n    }\n  ];\n\n  const validatorPassed =\n    validatorChecks.every(\n      (item) =>\n        item.result.ok ===\n          true &&\n        item.result.payload\n          ?.allowed ===\n          item.expectedAllowed &&\n        item.result.payload\n          ?.reason ===\n          item.expectedReason\n    );\n\n  const checks = {\n    configReadable:\n      config.ok ===\n        true,\n\n    modeIsStrict:\n      configRow?.mode ===\n        \"STRICT\",\n\n    versionCorrect:\n      configRow?.version ===\n        \"ALPHA_V3_ORDER_STATE_MACHINE_V1\",\n\n    paperOrdersRemainZero:\n      orders.ok ===\n        true &&\n      orders.count ===\n        0,\n\n    riskApprovedRemainZero:\n      approved.ok ===\n        true &&\n      approved.count ===\n        0,\n\n    activeReservationsRemainZero:\n      reservations.ok ===\n        true &&\n      reservations.count ===\n        0,\n\n    paperPositionsRemainZero:\n      positions.ok ===\n        true &&\n      positions.count ===\n        0,\n\n    invalidAuditRowsRemainZero:\n      invalidAudit.ok ===\n        true &&\n      invalidAudit.count ===\n        0,\n\n    validatorContractStillCorrect:\n      validatorPassed\n  };\n\n  const failed =\n    Object.entries(\n      checks\n    )\n      .filter(\n        ([, value]) =>\n          !value\n      )\n      .map(\n        ([key]) =>\n          key\n      );\n\n  const report = {\n    status:\n      failed.length === 0\n        ? \"ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_DB_VERIFIED\"\n        : \"ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_DB_REVIEW\",\n\n    checks,\n    failed,\n\n    config:\n      configRow,\n\n    counts: {\n      paperOrders:\n        orders.count,\n\n      riskApproved:\n        approved.count,\n\n      activeReservations:\n        reservations.count,\n\n      paperPositions:\n        positions.count,\n\n      invalidAuditRows:\n        invalidAudit.count\n    },\n\n    validatorChecks:\n      validatorChecks.map(\n        (item) => ({\n          name:\n            item.name,\n\n          passed:\n            item.result.ok ===\n              true &&\n            item.result.payload\n              ?.allowed ===\n              item.expectedAllowed &&\n            item.result.payload\n              ?.reason ===\n              item.expectedReason,\n\n          expected: {\n            allowed:\n              item.expectedAllowed,\n\n            reason:\n              item.expectedReason\n          },\n\n          observed:\n            item.result\n        })\n      ),\n\n    enforcement: {\n      mode:\n        configRow?.mode ??\n        null,\n\n      invalidTransitionsBlockedByTrigger:\n        configRow?.mode ===\n          \"STRICT\",\n\n      productionTriggerWriteTestPerformed:\n        false,\n\n      reason:\n        \"No production paper order row was created solely for verification. Trigger blocking is activated by the already-verified trigger function when config mode is STRICT.\"\n    },\n\n    safety: {\n      databaseReads:\n        6,\n\n      validatorRpcCalls:\n        4,\n\n      validatorRpcWrites:\n        0,\n\n      paperOrderWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      ordersChanged:\n        0,\n\n      positionsChanged:\n        0\n    },\n\n    nextGate:\n      failed.length === 0\n        ? \"RUN_STRICT_MODE_NO_ORDER_OPERATIONAL_COMPATIBILITY\"\n        : \"REVIEW_STRICT_ACTIVATION\"\n  };\n\n  const outputFile =\n    path.resolve(\n      root,\n      \"logs/alpha-v3-order-state-strict-activation-v1-db-verify.json\"\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile\n    ),\n    {\n      recursive:\n        true\n    }\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2\n    )\n  );\n\n  if (\n    failed.length >\n      0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_DB_VERIFY_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            paperOrderWrites:\n              0,\n\n            ordersCreated:\n              0,\n\n            positionsChanged:\n              0\n          },\n\n          nextGate:\n            \"REVIEW_STRICT_ACTIVATION_FATAL\"\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode =\n      2;\n  }\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_INSTALLED",

      generatedFiles: [
        migrationRel,
        staticRel,
        dbVerifyRel
      ],

      transition: {
        from:
          "AUDIT",

        to:
          "STRICT"
      },

      migrationPreconditions: [
        "MODE_MUST_BE_AUDIT",
        "VERSION_MUST_BE_V1",
        "PAPER_ORDER_COUNT_ZERO",
        "RISK_APPROVED_COUNT_ZERO",
        "ACTIVE_RESERVATION_COUNT_ZERO",
        "PAPER_POSITION_COUNT_ZERO",
        "INVALID_AUDIT_COUNT_ZERO",
        "AUDIT_TRIGGER_MUST_EXIST"
      ],

      safety: {
        createsTestOrders:
          false,

        changesPaperOrders:
          false,

        changesPaperPositions:
          false,

        onlyIntendedProductionWrite:
          "paper_order_state_machine_config.mode=AUDIT->STRICT"
      },

      nextAction:
        "STATIC_VERIFY_THEN_DB_PUSH_THEN_DB_VERIFY"
    },
    null,
    2
  )
);
