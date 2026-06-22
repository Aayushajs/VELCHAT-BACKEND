-- 0009 — tenancy: organizations, workspaces, teams, memberships, roles (§B3 / §A13). These tables
-- DEFINE tenants (an org/workspace IS a tenant), so they are keyed by their own id + user_id, not
-- RLS-scoped. A user's role in one scope is independent of any other (per-tenant RBAC). Expand-only.

CREATE TABLE IF NOT EXISTS organizations (
  org_id         uuid PRIMARY KEY,
  name           text NOT NULL,
  plan           text NOT NULL DEFAULT 'free',
  sso_config     jsonb,
  retention_days int,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id uuid PRIMARY KEY,
  name         text NOT NULL,
  org_id       uuid REFERENCES organizations(org_id),   -- null = standalone (Slack-style)
  settings     jsonb,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  team_id    uuid PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organizations(org_id),
  name       text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  scope_type text NOT NULL,                              -- org | workspace | team
  scope_id   uuid NOT NULL,
  role       text NOT NULL,                              -- owner | admin | member | guest | bot
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);
CREATE INDEX IF NOT EXISTS memberships_scope_idx ON memberships (scope_type, scope_id);

-- Static role → permission policy (reference; the service also enforces a role rank).
CREATE TABLE IF NOT EXISTS roles_permissions (
  role       text NOT NULL,
  permission text NOT NULL,
  PRIMARY KEY (role, permission)
);
INSERT INTO roles_permissions(role, permission) VALUES
  ('owner','manage_tenant'), ('owner','manage_members'), ('owner','manage_channels'), ('owner','post'), ('owner','read'),
  ('admin','manage_members'), ('admin','manage_channels'), ('admin','post'), ('admin','read'),
  ('member','post'), ('member','read'),
  ('guest','read'),
  ('bot','post'), ('bot','read')
ON CONFLICT DO NOTHING;
