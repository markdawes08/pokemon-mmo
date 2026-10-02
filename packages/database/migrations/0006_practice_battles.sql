-- Explicit development practice activity; ordinary staged accounts remain restricted.
ALTER TABLE characters DROP CONSTRAINT characters_development_profile;
ALTER TABLE characters ADD CONSTRAINT characters_development_profile CHECK (
  stage <> 'development-fixture' OR (activity IN ('recovering','overworld','transferring','battle') AND map_id IS NOT NULL)
);

-- Practice snapshots are separate from owned creatures, inventory and domain rewards.
-- Keep the per-character revision when closed, fencing commands from older sessions.
CREATE TABLE character_practice_state (
  character_id uuid PRIMARY KEY REFERENCES characters(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  battle_id uuid,
  checkpoint jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((battle_id IS NULL AND checkpoint IS NULL) OR
    (battle_id IS NOT NULL AND checkpoint IS NOT NULL AND jsonb_typeof(checkpoint) = 'object'))
);
CREATE TABLE practice_command_receipts (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (character_id, command_id)
);
