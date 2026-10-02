-- Local Route 1 testing persists its field RNG separately from owned progress.
CREATE TABLE character_wild_test_state (
  character_id uuid PRIMARY KEY REFERENCES characters(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  enabled boolean NOT NULL DEFAULT false,
  checkpoint jsonb,
  last_step_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (checkpoint IS NULL OR jsonb_typeof(checkpoint) = 'object'),
  CHECK (NOT enabled OR checkpoint IS NOT NULL)
);
CREATE TABLE wild_test_command_receipts (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (character_id, command_id)
);
ALTER TABLE character_practice_state ADD COLUMN origin jsonb;
ALTER TABLE character_practice_state ADD CONSTRAINT character_practice_origin_check
  CHECK (origin IS NULL OR (battle_id IS NOT NULL AND jsonb_typeof(origin) = 'object'));
