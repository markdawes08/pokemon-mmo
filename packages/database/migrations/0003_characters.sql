-- Bounded P04: staged trainer profiles only. No world progress or owned assets exist yet.
CREATE TABLE characters (
  id uuid PRIMARY KEY,
  account_id text NOT NULL UNIQUE REFERENCES auth_user(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (name ~ '^[A-Z]{1,7}$'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  stage text NOT NULL DEFAULT 'awaiting-new-game' CHECK (stage = 'awaiting-new-game'),
  activity text NOT NULL DEFAULT 'recovering' CHECK (activity IN ('overworld', 'scripted_event', 'battle', 'trade', 'transferring', 'recovering')),
  activity_id uuid NOT NULL,
  map_id text,
  position_x integer CHECK (position_x >= 0),
  position_y integer CHECK (position_y >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  saved_at timestamptz,
  CONSTRAINT characters_location_complete CHECK (
    (map_id IS NULL AND position_x IS NULL AND position_y IS NULL) OR
    (map_id IS NOT NULL AND length(map_id) > 0 AND position_x IS NOT NULL AND position_y IS NOT NULL)
  ),
  CONSTRAINT characters_staged_profile CHECK (stage <> 'awaiting-new-game' OR (activity = 'recovering' AND map_id IS NULL))
);

-- Rows survive release so generation counters never reset. All writes lock character first, lease second.
CREATE TABLE character_leases (
  character_id uuid PRIMARY KEY REFERENCES characters(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL,
  lease_generation bigint NOT NULL CHECK (lease_generation BETWEEN 1 AND 9007199254740991),
  connection_generation bigint NOT NULL CHECK (connection_generation BETWEEN 1 AND 9007199254740991),
  expires_at timestamptz NOT NULL
);
CREATE INDEX character_leases_expiry_idx ON character_leases(expires_at);

CREATE TABLE account_creation_receipts (
  account_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, command_id)
);

CREATE TABLE character_command_receipts (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (character_id, command_id)
);
