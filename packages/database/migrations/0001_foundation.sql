CREATE TABLE runtime_metadata (
  key text PRIMARY KEY,
  protocol_version integer NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runtime_metadata_key_nonempty CHECK (length(key) > 0),
  CONSTRAINT runtime_metadata_protocol_positive CHECK (protocol_version > 0)
);
INSERT INTO runtime_metadata (key, protocol_version, value)
VALUES ('foundation', 1, '{"phase":"P01","schemaVersion":1}'::jsonb);
