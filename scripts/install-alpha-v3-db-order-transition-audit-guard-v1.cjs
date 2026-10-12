const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const migrationRel =
  "supabase/migrations/20261008001200_order_state_machine_audit_guard_v1.sql";

const staticVerifyRel =
  "scripts/alpha-v3-db-order-transition-audit-guard-v1-static-verify.cjs";

const dbVerifyRel =
  "scripts/alpha-v3-db-order-transition-audit-guard-v1-db-verify.cjs";

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
    recursive: true
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
  "begin;\n\ncreate table if not exists public.paper_order_state_machine_config (\n  id smallint primary key default 1,\n  mode text not null default 'AUDIT',\n  version text not null default 'ALPHA_V3_ORDER_STATE_MACHINE_V1',\n  updated_at timestamptz not null default now(),\n  constraint paper_order_state_machine_config_singleton\n    check (id = 1),\n  constraint paper_order_state_machine_config_mode\n    check (mode in ('AUDIT', 'STRICT'))\n);\n\ninsert into public.paper_order_state_machine_config (\n  id,\n  mode,\n  version,\n  updated_at\n)\nvalues (\n  1,\n  'AUDIT',\n  'ALPHA_V3_ORDER_STATE_MACHINE_V1',\n  now()\n)\non conflict (id)\ndo update set\n  mode = 'AUDIT',\n  version = excluded.version,\n  updated_at = now();\n\ncreate table if not exists public.paper_order_state_transition_audit (\n  id bigint generated always as identity primary key,\n  observed_at timestamptz not null default now(),\n  state_machine_version text not null,\n  enforcement_mode text not null,\n  event_type text not null,\n  order_id_text text null,\n  account_id_text text null,\n  stock_code text null,\n  side text null,\n  old_status text null,\n  new_status text null,\n  normalized_old_status text null,\n  normalized_new_status text null,\n  allowed boolean not null,\n  idempotent boolean not null default false,\n  reason text not null,\n  validation_payload jsonb not null default '{}'::jsonb,\n  constraint paper_order_state_transition_audit_event_type\n    check (event_type in ('INSERT', 'UPDATE')),\n  constraint paper_order_state_transition_audit_mode\n    check (enforcement_mode in ('AUDIT', 'STRICT'))\n);\n\ncreate index if not exists\n  paper_order_state_transition_audit_observed_at_idx\non public.paper_order_state_transition_audit (\n  observed_at desc\n);\n\ncreate index if not exists\n  paper_order_state_transition_audit_allowed_idx\non public.paper_order_state_transition_audit (\n  allowed,\n  observed_at desc\n);\n\ncreate or replace function public.normalize_paper_order_status_v1(\n  p_status text\n)\nreturns text\nlanguage sql\nimmutable\nas $$\n  select\n    case upper(trim(coalesce(p_status, '')))\n      when 'CANCELED' then 'CANCELLED'\n      when 'RISK_APPROVED' then 'RISK_APPROVED'\n      when 'RISK_REJECTED' then 'RISK_REJECTED'\n      when 'FILLED' then 'FILLED'\n      when 'EXPIRED' then 'EXPIRED'\n      when 'CANCELLED' then 'CANCELLED'\n      when 'FAILED' then 'FAILED'\n      else null\n    end;\n$$;\n\ncreate or replace function public.validate_paper_order_state_transition_v1(\n  p_old_status text,\n  p_new_status text,\n  p_is_insert boolean default false\n)\nreturns jsonb\nlanguage plpgsql\nimmutable\nas $$\ndeclare\n  v_old text;\n  v_new text;\n  v_allowed boolean := false;\n  v_idempotent boolean := false;\n  v_reason text;\nbegin\n  v_old :=\n    public.normalize_paper_order_status_v1(\n      p_old_status\n    );\n\n  v_new :=\n    public.normalize_paper_order_status_v1(\n      p_new_status\n    );\n\n  if v_new is null then\n    v_reason := 'UNSUPPORTED_TO_STATUS';\n\n  elsif p_is_insert then\n    if v_new in (\n      'RISK_APPROVED',\n      'RISK_REJECTED',\n      'FILLED'\n    ) then\n      v_allowed := true;\n      v_reason := 'CREATE_ALLOWED';\n    else\n      v_reason := 'CREATE_STATUS_NOT_ALLOWED';\n    end if;\n\n  elsif v_old is null then\n    v_reason := 'UNSUPPORTED_FROM_STATUS';\n\n  elsif v_old = v_new then\n    v_allowed := true;\n    v_idempotent := true;\n    v_reason := 'IDEMPOTENT_NOOP';\n\n  elsif v_old in (\n    'RISK_REJECTED',\n    'FILLED',\n    'EXPIRED',\n    'CANCELLED',\n    'FAILED'\n  ) then\n    v_reason := 'TERMINAL_STATE_CANNOT_TRANSITION';\n\n  elsif\n    v_old = 'RISK_APPROVED'\n    and\n    v_new in (\n      'FILLED',\n      'EXPIRED'\n    )\n  then\n    v_allowed := true;\n    v_reason := 'TRANSITION_ALLOWED';\n\n  else\n    v_reason := 'TRANSITION_NOT_ALLOWED';\n  end if;\n\n  return jsonb_build_object(\n    'allowed', v_allowed,\n    'idempotent', v_idempotent,\n    'from', v_old,\n    'to', v_new,\n    'oldRaw', p_old_status,\n    'newRaw', p_new_status,\n    'isInsert', p_is_insert,\n    'reason', v_reason,\n    'version', 'ALPHA_V3_ORDER_STATE_MACHINE_V1'\n  );\nend;\n$$;\n\ncreate or replace function public.audit_paper_order_state_transition_v1()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_mode text := 'AUDIT';\n  v_validation jsonb;\n  v_allowed boolean;\n  v_idempotent boolean;\n  v_reason text;\n  v_old_normalized text;\n  v_new_normalized text;\nbegin\n  select c.mode\n  into v_mode\n  from public.paper_order_state_machine_config c\n  where c.id = 1;\n\n  v_mode :=\n    coalesce(\n      v_mode,\n      'AUDIT'\n    );\n\n  if tg_op = 'INSERT' then\n    v_validation :=\n      public.validate_paper_order_state_transition_v1(\n        null,\n        new.status,\n        true\n      );\n  else\n    if old.status is not distinct from new.status then\n      return new;\n    end if;\n\n    v_validation :=\n      public.validate_paper_order_state_transition_v1(\n        old.status,\n        new.status,\n        false\n      );\n  end if;\n\n  v_allowed :=\n    coalesce(\n      (v_validation ->> 'allowed')::boolean,\n      false\n    );\n\n  v_idempotent :=\n    coalesce(\n      (v_validation ->> 'idempotent')::boolean,\n      false\n    );\n\n  v_reason :=\n    coalesce(\n      v_validation ->> 'reason',\n      'UNKNOWN_VALIDATION_RESULT'\n    );\n\n  v_old_normalized :=\n    v_validation ->> 'from';\n\n  v_new_normalized :=\n    v_validation ->> 'to';\n\n  insert into public.paper_order_state_transition_audit (\n    state_machine_version,\n    enforcement_mode,\n    event_type,\n    order_id_text,\n    account_id_text,\n    stock_code,\n    side,\n    old_status,\n    new_status,\n    normalized_old_status,\n    normalized_new_status,\n    allowed,\n    idempotent,\n    reason,\n    validation_payload\n  )\n  values (\n    'ALPHA_V3_ORDER_STATE_MACHINE_V1',\n    v_mode,\n    tg_op,\n    new.id::text,\n    new.account_id::text,\n    new.stock_code::text,\n    new.side::text,\n    case\n      when tg_op = 'UPDATE'\n        then old.status::text\n      else null\n    end,\n    new.status::text,\n    v_old_normalized,\n    v_new_normalized,\n    v_allowed,\n    v_idempotent,\n    v_reason,\n    v_validation\n  );\n\n  if\n    v_mode = 'STRICT'\n    and\n    not v_allowed\n  then\n    raise exception\n      using\n        errcode = '23514',\n        message =\n          format(\n            'ORDER_STATE_TRANSITION_REJECTED old=%s new=%s reason=%s',\n            coalesce(\n              case\n                when tg_op = 'UPDATE'\n                  then old.status::text\n                else '__CREATE__'\n              end,\n              '__NULL__'\n            ),\n            coalesce(\n              new.status::text,\n              '__NULL__'\n            ),\n            v_reason\n          );\n  end if;\n\n  return new;\nend;\n$$;\n\ndrop trigger if exists\n  zz_paper_order_state_transition_audit_v1\non public.paper_order_requests;\n\ncreate trigger\n  zz_paper_order_state_transition_audit_v1\nafter insert or update of status\non public.paper_order_requests\nfor each row\nexecute function\n  public.audit_paper_order_state_transition_v1();\n\nrevoke all on\n  public.paper_order_state_machine_config\nfrom public, anon, authenticated;\n\nrevoke all on\n  public.paper_order_state_transition_audit\nfrom public, anon, authenticated;\n\ngrant select, update on\n  public.paper_order_state_machine_config\nto service_role;\n\ngrant select on\n  public.paper_order_state_transition_audit\nto service_role;\n\nrevoke all on function\n  public.normalize_paper_order_status_v1(text)\nfrom public, anon, authenticated;\n\nrevoke all on function\n  public.validate_paper_order_state_transition_v1(text, text, boolean)\nfrom public, anon, authenticated;\n\ngrant execute on function\n  public.normalize_paper_order_status_v1(text)\nto service_role;\n\ngrant execute on function\n  public.validate_paper_order_state_transition_v1(text, text, boolean)\nto service_role;\n\ncomment on table\n  public.paper_order_state_machine_config\nis\n  'Alpha V3 order state machine enforcement mode. V1 installs in AUDIT mode only.';\n\ncomment on table\n  public.paper_order_state_transition_audit\nis\n  'Alpha V3 paper order state transition audit trail. Invalid transitions are observed but not blocked while mode=AUDIT.';\n\ncomment on function\n  public.validate_paper_order_state_transition_v1(text, text, boolean)\nis\n  'Pure Alpha V3 order-state validator shared by audit trigger and verification probes.';\n\ncommit;\n",
  "utf8"
);

fs.mkdirSync(
  path.resolve(
    root,
    "scripts"
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  path.resolve(
    root,
    staticVerifyRel
  ),
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst migrationFile = path.resolve(\n  root,\n  \"supabase/migrations/20261008001200_order_state_machine_audit_guard_v1.sql\"\n);\n\nif (!fs.existsSync(migrationFile)) {\n  throw new Error(\n    \"ORDER_STATE_MACHINE_AUDIT_MIGRATION_NOT_FOUND\"\n  );\n}\n\nconst text =\n  fs.readFileSync(\n    migrationFile,\n    \"utf8\"\n  );\n\nconst checks = {\n  configTablePresent:\n    text.includes(\n      \"paper_order_state_machine_config\"\n    ),\n\n  auditTablePresent:\n    text.includes(\n      \"paper_order_state_transition_audit\"\n    ),\n\n  defaultModeAudit:\n    /mode\\s+text\\s+not\\s+null\\s+default\\s+'AUDIT'/i.test(\n      text\n    ),\n\n  migrationForcesAuditMode:\n    /on conflict[\\s\\S]{0,300}?mode\\s*=\\s*'AUDIT'/im.test(\n      text\n    ),\n\n  validatorPresent:\n    text.includes(\n      \"validate_paper_order_state_transition_v1\"\n    ),\n\n  normalizationPresent:\n    text.includes(\n      \"normalize_paper_order_status_v1\"\n    ),\n\n  canceledAlias:\n    /when\\s+'CANCELED'\\s+then\\s+'CANCELLED'/i.test(\n      text\n    ),\n\n  createApprovedAllowed:\n    /p_is_insert[\\s\\S]{0,700}?'RISK_APPROVED'[\\s\\S]{0,200}?'RISK_REJECTED'[\\s\\S]{0,200}?'FILLED'/im.test(\n      text\n    ),\n\n  riskApprovedFillExpiry:\n    /v_old\\s*=\\s*'RISK_APPROVED'[\\s\\S]{0,250}?'FILLED'[\\s\\S]{0,120}?'EXPIRED'/im.test(\n      text\n    ),\n\n  terminalGuard:\n    /'RISK_REJECTED'[\\s\\S]{0,200}?'FILLED'[\\s\\S]{0,200}?'EXPIRED'[\\s\\S]{0,200}?'CANCELLED'[\\s\\S]{0,200}?'FAILED'/im.test(\n      text\n    ),\n\n  auditTriggerPresent:\n    text.includes(\n      \"zz_paper_order_state_transition_audit_v1\"\n    ),\n\n  triggerIsAfter:\n    /create trigger[\\s\\S]{0,120}?after insert or update of status/im.test(\n      text\n    ),\n\n  strictBranchExists:\n    /v_mode\\s*=\\s*'STRICT'[\\s\\S]{0,120}?not v_allowed/im.test(\n      text\n    ),\n\n  strictIsNotDefault:\n    !/default\\s+'STRICT'/i.test(\n      text\n    ),\n\n  serviceRoleOnlyValidator:\n    /revoke all on function[\\s\\S]{0,250}?validate_paper_order_state_transition_v1[\\s\\S]{0,350}?from public, anon, authenticated/im.test(\n      text\n    ),\n\n  noPaperOrderTableConstraintAdded:\n    !/alter table\\s+public\\.paper_order_requests[\\s\\S]{0,300}?add constraint/im.test(\n      text\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([key]) =>\n        key\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      enforcementMode:\n        \"AUDIT\",\n\n      behavior: {\n        invalidTransitionsBlocked:\n          false,\n\n        allStatusCreatesAndChangesAudited:\n          true,\n\n        productionPaperOrderConstraintAdded:\n          false,\n\n        legacyRowsRewritten:\n          false,\n      },\n\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        ordersCreated: 0,\n        ordersChanged: 0,\n        positionsChanged: 0,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"APPLY_AUDIT_GUARD_MIGRATION_AND_VERIFY_DB\"\n          : \"REVIEW_AUDIT_GUARD_MIGRATION\",\n    },\n    null,\n    2\n  )\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n",
  "utf8"
);

fs.writeFileSync(
  path.resolve(
    root,
    dbVerifyRel
  ),
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nfunction parseEnvFile(file) {\n  const env = {};\n\n  if (!fs.existsSync(file)) {\n    return env;\n  }\n\n  const text =\n    fs.readFileSync(\n      file,\n      \"utf8\"\n    );\n\n  for (const rawLine of text.split(/\\r?\\n/)) {\n    const line = rawLine.trim();\n\n    if (\n      !line ||\n      line.startsWith(\"#\")\n    ) {\n      continue;\n    }\n\n    const index =\n      line.indexOf(\"=\");\n\n    if (index <= 0) {\n      continue;\n    }\n\n    const key =\n      line\n        .slice(0, index)\n        .trim();\n\n    let value =\n      line\n        .slice(index + 1)\n        .trim();\n\n    if (\n      (\n        value.startsWith('\"') &&\n        value.endsWith('\"')\n      ) ||\n      (\n        value.startsWith(\"'\") &&\n        value.endsWith(\"'\")\n      )\n    ) {\n      value =\n        value.slice(1, -1);\n    }\n\n    env[key] = value;\n  }\n\n  return env;\n}\n\nconst env = {\n  ...parseEnvFile(\n    path.resolve(root, \".env.local\")\n  ),\n  ...process.env\n};\n\nconst supabaseUrl =\n  String(\n    env.NEXT_PUBLIC_SUPABASE_URL ||\n    env.SUPABASE_URL ||\n    \"\"\n  )\n    .trim()\n    .replace(/\\/+$/, \"\");\n\nconst serviceRoleKey =\n  String(\n    env.SUPABASE_SERVICE_ROLE_KEY ||\n    env.SUPABASE_SERVICE_KEY ||\n    \"\"\n  ).trim();\n\nif (\n  !supabaseUrl ||\n  !serviceRoleKey\n) {\n  throw new Error(\n    \"SUPABASE_SERVICE_ROLE_CONFIG_MISSING\"\n  );\n}\n\nasync function parseResponse(response) {\n  const text =\n    await response.text();\n\n  try {\n    return text\n      ? JSON.parse(text)\n      : null;\n  } catch {\n    return {\n      raw: text\n    };\n  }\n}\n\nasync function get(pathname) {\n  const response =\n    await fetch(\n      supabaseUrl +\n      pathname,\n      {\n        method:\n          \"GET\",\n\n        headers: {\n          apikey:\n            serviceRoleKey,\n\n          authorization:\n            \"Bearer \" +\n            serviceRoleKey,\n        },\n\n        cache:\n          \"no-store\",\n      }\n    );\n\n  return {\n    status:\n      response.status,\n\n    ok:\n      response.ok,\n\n    payload:\n      await parseResponse(\n        response\n      ),\n  };\n}\n\nasync function rpc(oldStatus, newStatus, isInsert) {\n  const response =\n    await fetch(\n      supabaseUrl +\n      \"/rest/v1/rpc/validate_paper_order_state_transition_v1\",\n      {\n        method:\n          \"POST\",\n\n        headers: {\n          apikey:\n            serviceRoleKey,\n\n          authorization:\n            \"Bearer \" +\n            serviceRoleKey,\n\n          \"content-type\":\n            \"application/json\",\n        },\n\n        body:\n          JSON.stringify({\n            p_old_status:\n              oldStatus,\n\n            p_new_status:\n              newStatus,\n\n            p_is_insert:\n              isInsert,\n          }),\n\n        cache:\n          \"no-store\",\n      }\n    );\n\n  return {\n    status:\n      response.status,\n\n    ok:\n      response.ok,\n\n    payload:\n      await parseResponse(\n        response\n      ),\n  };\n}\n\nasync function main() {\n  const config =\n    await get(\n      \"/rest/v1/paper_order_state_machine_config?select=id,mode,version&limit=1\"\n    );\n\n  const auditRows =\n    await get(\n      \"/rest/v1/paper_order_state_transition_audit?select=id,allowed,reason&limit=10\"\n    );\n\n  const scenarios = [\n    {\n      name:\n        \"CREATE_RISK_APPROVED\",\n      args:\n        [null, \"RISK_APPROVED\", true],\n      expectedAllowed:\n        true,\n      expectedReason:\n        \"CREATE_ALLOWED\",\n    },\n    {\n      name:\n        \"CREATE_RISK_REJECTED\",\n      args:\n        [null, \"RISK_REJECTED\", true],\n      expectedAllowed:\n        true,\n      expectedReason:\n        \"CREATE_ALLOWED\",\n    },\n    {\n      name:\n        \"CREATE_FILLED\",\n      args:\n        [null, \"FILLED\", true],\n      expectedAllowed:\n        true,\n      expectedReason:\n        \"CREATE_ALLOWED\",\n    },\n    {\n      name:\n        \"CREATE_CANCELLED_BLOCK_CANDIDATE\",\n      args:\n        [null, \"CANCELLED\", true],\n      expectedAllowed:\n        false,\n      expectedReason:\n        \"CREATE_STATUS_NOT_ALLOWED\",\n    },\n    {\n      name:\n        \"RISK_APPROVED_TO_FILLED\",\n      args:\n        [\"RISK_APPROVED\", \"FILLED\", false],\n      expectedAllowed:\n        true,\n      expectedReason:\n        \"TRANSITION_ALLOWED\",\n    },\n    {\n      name:\n        \"RISK_APPROVED_TO_EXPIRED\",\n      args:\n        [\"RISK_APPROVED\", \"EXPIRED\", false],\n      expectedAllowed:\n        true,\n      expectedReason:\n        \"TRANSITION_ALLOWED\",\n    },\n    {\n      name:\n        \"RISK_APPROVED_TO_CANCELLED_NOT_ENABLED\",\n      args:\n        [\"RISK_APPROVED\", \"CANCELLED\", false],\n      expectedAllowed:\n        false,\n      expectedReason:\n        \"TRANSITION_NOT_ALLOWED\",\n    },\n    {\n      name:\n        \"FILLED_TO_EXPIRED_TERMINAL_BLOCK\",\n      args:\n        [\"FILLED\", \"EXPIRED\", false],\n      expectedAllowed:\n        false,\n      expectedReason:\n        \"TERMINAL_STATE_CANNOT_TRANSITION\",\n    },\n    {\n      name:\n        \"FILLED_RETRY_IDEMPOTENT\",\n      args:\n        [\"FILLED\", \"FILLED\", false],\n      expectedAllowed:\n        true,\n      expectedReason:\n        \"IDEMPOTENT_NOOP\",\n    },\n    {\n      name:\n        \"CANCELED_TO_CANCELLED_ALIAS_IDEMPOTENT\",\n      args:\n        [\"CANCELED\", \"CANCELLED\", false],\n      expectedAllowed:\n        true,\n      expectedReason:\n        \"IDEMPOTENT_NOOP\",\n    },\n    {\n      name:\n        \"APPROVED_UNSUPPORTED_FROM\",\n      args:\n        [\"APPROVED\", \"RISK_APPROVED\", false],\n      expectedAllowed:\n        false,\n      expectedReason:\n        \"UNSUPPORTED_FROM_STATUS\",\n    },\n  ];\n\n  const results = [];\n\n  for (const scenario of scenarios) {\n    const result =\n      await rpc(\n        ...scenario.args\n      );\n\n    const payload =\n      result.payload;\n\n    results.push({\n      name:\n        scenario.name,\n\n      passed:\n        result.ok === true &&\n        payload?.allowed ===\n          scenario.expectedAllowed &&\n        payload?.reason ===\n          scenario.expectedReason,\n\n      expected: {\n        allowed:\n          scenario.expectedAllowed,\n        reason:\n          scenario.expectedReason,\n      },\n\n      observed: {\n        httpStatus:\n          result.status,\n        ok:\n          result.ok,\n        payload,\n      },\n    });\n  }\n\n  const configRow =\n    Array.isArray(\n      config.payload\n    )\n      ? config.payload[0] ??\n        null\n      : null;\n\n  const checks = {\n    configReadable:\n      config.ok === true,\n\n    modeIsAudit:\n      configRow?.mode ===\n        \"AUDIT\",\n\n    versionCorrect:\n      configRow?.version ===\n        \"ALPHA_V3_ORDER_STATE_MACHINE_V1\",\n\n    auditTableReadable:\n      auditRows.ok ===\n        true,\n\n    validatorScenariosPass:\n      results.every(\n        (item) =>\n          item.passed\n      ),\n  };\n\n  const failed =\n    Object.entries(checks)\n      .filter(\n        ([, value]) =>\n          !value\n      )\n      .map(\n        ([key]) =>\n          key\n      );\n\n  const report = {\n    status:\n      failed.length === 0\n        ? \"ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_DB_VERIFIED\"\n        : \"ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_DB_REVIEW\",\n\n    checks,\n    failed,\n\n    config:\n      configRow,\n\n    currentAuditRowCountSample:\n      Array.isArray(\n        auditRows.payload\n      )\n        ? auditRows.payload.length\n        : null,\n\n    scenarios:\n      results,\n\n    enforcement: {\n      mode:\n        configRow?.mode ??\n        null,\n\n      invalidTransitionsBlocked:\n        false,\n\n      strictActivationPerformed:\n        false,\n    },\n\n    safety: {\n      validatorRpcCalls:\n        scenarios.length,\n\n      validatorRpcWrites:\n        0,\n\n      paperOrderWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      ordersChanged:\n        0,\n\n      positionsChanged:\n        0,\n    },\n\n    nextGate:\n      failed.length === 0\n        ? \"RUN_AUDIT_MODE_OPERATIONAL_COMPATIBILITY_CHECK\"\n        : \"REVIEW_DB_AUDIT_GUARD\",\n  };\n\n  const outputFile =\n    path.resolve(\n      root,\n      \"logs/alpha-v3-db-order-transition-audit-guard-v1-db-verify.json\"\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile\n    ),\n    {\n      recursive: true\n    }\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2\n    )\n  );\n\n  if (failed.length > 0) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_DB_VERIFY_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            paperOrderWrites: 0,\n            ordersCreated: 0,\n            positionsChanged: 0,\n          },\n\n          nextGate:\n            \"REVIEW_DB_AUDIT_GUARD_FATAL\",\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode =\n      2;\n  }\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_INSTALLED",

      generatedFiles: [
        migrationRel,
        staticVerifyRel,
        dbVerifyRel
      ],

      enforcementMode:
        "AUDIT",

      behavior: {
        recordsValidTransitions:
          true,

        recordsInvalidTransitions:
          true,

        blocksInvalidTransitions:
          false,

        rewritesLegacyRows:
          false,

        addsPaperOrderConstraint:
          false,

        strictModeCodePresentButDisabled:
          true
      },

      validatorContract: {
        createAllowed: [
          "RISK_APPROVED",
          "RISK_REJECTED",
          "FILLED"
        ],

        activeTransitions: {
          RISK_APPROVED: [
            "FILLED",
            "EXPIRED"
          ]
        },

        terminal: [
          "RISK_REJECTED",
          "FILLED",
          "EXPIRED",
          "CANCELLED",
          "FAILED"
        ],

        legacyAlias: {
          CANCELED:
            "CANCELLED"
        }
      },

      nextAction:
        "STATIC_VERIFY_THEN_APPLY_MIGRATION_THEN_DB_VERIFY"
    },
    null,
    2
  )
);
