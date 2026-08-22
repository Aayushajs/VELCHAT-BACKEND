/**
 * Feature Flag & Remote-Config domain types (docs/FEATURE-FLAGS.md §3/§4). MongoDB-only. Ids are
 * app-generated uuidv7 strings; `tenant_id === null` means a global/platform-wide flag.
 */

export type FlagType = 'boolean' | 'config' | 'experiment';
export type FlagState = 'active' | 'archived';
export type RuleOp = 'in' | 'eq' | 'neq' | 'gte' | 'lte' | 'semverGte' | 'semverLt';
export type ScheduleAction = 'enable' | 'disable';
export type FlagAction =
  | 'create'
  | 'update'
  | 'enable'
  | 'disable'
  | 'rollout'
  | 'rollback'
  | 'schedule'
  | 'kill'
  | 'archive'
  | 'maintenance'
  | 'announcement';

/** A single targeting predicate — `attribute op values` (ALL rules AND together). */
export interface RolloutRule {
  attribute: string; // country | platform | appVersion | role | userId | <custom attr>
  op: RuleOp;
  values: string[];
}

/** A multivariate arm (experiments). Weights are relative and need not sum to 100. */
export interface Variant {
  key: string;
  value: unknown;
  weight: number;
}

export interface Rollout {
  percentage: number; // 0..100
  segmentIds: string[]; // any-match (OR)
  rules: RolloutRule[]; // all-match (AND)
  userOverrides: Record<string, unknown>; // userId → value|variantKey|boolean (highest priority)
}

export interface FeatureFlag {
  _id: string;
  key: string;
  tenant_id: string | null;
  type: FlagType;
  description?: string;
  tags: string[];
  enabled: boolean; // master kill switch
  value?: unknown; // remote-config payload (type=config)
  defaultValue: unknown; // returned when off / not targeted
  variants: Variant[];
  rollout: Rollout;
  dependencies: string[]; // flag keys — ON only if all dependencies evaluate ON
  state: FlagState;
  version: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface Segment {
  _id: string;
  key: string;
  tenant_id: string | null;
  name: string;
  rules: RolloutRule[];
  created_at: string;
}

/** Immutable version snapshot for history + rollback (§3.3). */
export interface FlagVersionDoc {
  _id: string;
  flag_id: string;
  key: string;
  tenant_id: string | null;
  version: number;
  snapshot: FeatureFlag;
  changed_by: string | null;
  reason?: string;
  created_at: string;
}

export interface FlagAuditDoc {
  _id: string;
  tenant_id: string | null;
  flag_id: string | null;
  actor_id: string | null;
  action: FlagAction;
  before: unknown;
  after: unknown;
  at: string;
}

export interface FlagScheduleDoc {
  _id: string;
  flag_id: string;
  tenant_id: string | null;
  action: ScheduleAction;
  run_at: string;
  status: 'pending' | 'done' | 'cancelled';
  created_by: string | null;
  created_at: string;
}

export interface MaintenanceConfig {
  enabled: boolean;
  message?: string;
  allowlistFlagKeys: string[];
  allowRoles: string[];
}

export interface AnnouncementConfig {
  enabled: boolean;
  level: 'info' | 'warn' | 'critical';
  text?: string;
  startsAt?: string;
  endsAt?: string;
}

/** Singleton per scope (`_id` = 'global' | tenant_id) — maintenance mode + announcement/banner. */
export interface PlatformConfigDoc {
  _id: string;
  maintenance: MaintenanceConfig;
  announcement: AnnouncementConfig | null;
  updated_by: string | null;
  updated_at: string;
}

/** Request evaluation context (attributes the rollout rules target). */
export interface EvalContext {
  userId?: string;
  country?: string;
  platform?: string;
  appVersion?: string;
  role?: string;
  attrs?: Record<string, string>;
}

/** A single flag's evaluated outcome. No internal config is exposed beyond value/variant. */
export interface EvalResult {
  key: string;
  on: boolean;
  value: unknown;
  variant?: string;
  reason:
    | 'killed'
    | 'dependency'
    | 'override'
    | 'rule'
    | 'segment'
    | 'percentage'
    | 'rollout'
    | 'maintenance';
}
