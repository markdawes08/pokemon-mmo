-- Additive P04 asset foundation. These rows do not enable world or battle mechanics.
ALTER TABLE characters DROP CONSTRAINT characters_stage_check;
ALTER TABLE characters ADD CONSTRAINT characters_stage_check CHECK (stage IN ('awaiting-new-game', 'development-fixture'));
ALTER TABLE characters ADD CONSTRAINT characters_development_profile CHECK (stage <> 'development-fixture' OR (activity = 'recovering' AND map_id IS NOT NULL));

CREATE TABLE content_versions (
  content_hash text PRIMARY KEY CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE content_species (
  content_hash text NOT NULL REFERENCES content_versions(content_hash) ON DELETE RESTRICT,
  source_id integer NOT NULL CHECK (source_id BETWEEN 1 AND 411), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 10),
  base_hp integer NOT NULL CHECK (base_hp BETWEEN 1 AND 255),
  base_attack integer NOT NULL CHECK (base_attack BETWEEN 1 AND 255),
  base_defense integer NOT NULL CHECK (base_defense BETWEEN 1 AND 255),
  base_speed integer NOT NULL CHECK (base_speed BETWEEN 1 AND 255),
  base_sp_attack integer NOT NULL CHECK (base_sp_attack BETWEEN 1 AND 255),
  base_sp_defense integer NOT NULL CHECK (base_sp_defense BETWEEN 1 AND 255),
  growth_rate integer NOT NULL CHECK (growth_rate BETWEEN 0 AND 5),
  PRIMARY KEY (content_hash, source_id)
);
CREATE TABLE content_moves (
  content_hash text NOT NULL REFERENCES content_versions(content_hash) ON DELETE RESTRICT,
  source_id integer NOT NULL CHECK (source_id BETWEEN 1 AND 354), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 12),
  base_pp integer NOT NULL CHECK (base_pp BETWEEN 1 AND 255), PRIMARY KEY (content_hash, source_id)
);
CREATE TABLE content_abilities (
  content_hash text NOT NULL REFERENCES content_versions(content_hash) ON DELETE RESTRICT,
  source_id integer NOT NULL CHECK (source_id BETWEEN 0 AND 77), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 12),
  PRIMARY KEY (content_hash, source_id)
);
CREATE TABLE content_items (
  content_hash text NOT NULL REFERENCES content_versions(content_hash) ON DELETE RESTRICT,
  source_id integer NOT NULL CHECK (source_id BETWEEN 0 AND 374), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 14),
  pocket text NOT NULL CHECK (pocket IN ('POCKET_ITEMS','POCKET_KEY_ITEMS','POCKET_POKE_BALLS','POCKET_TM_CASE','POCKET_BERRY_POUCH')),
  PRIMARY KEY (content_hash, source_id), UNIQUE (content_hash, source_id, pocket)
);
CREATE FUNCTION reject_content_registry_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Content definitions are immutable; insert a new content version' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER content_versions_immutable BEFORE UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION reject_content_registry_mutation();
CREATE TRIGGER content_species_immutable BEFORE UPDATE OR DELETE ON content_species FOR EACH ROW EXECUTE FUNCTION reject_content_registry_mutation();
CREATE TRIGGER content_moves_immutable BEFORE UPDATE OR DELETE ON content_moves FOR EACH ROW EXECUTE FUNCTION reject_content_registry_mutation();
CREATE TRIGGER content_abilities_immutable BEFORE UPDATE OR DELETE ON content_abilities FOR EACH ROW EXECUTE FUNCTION reject_content_registry_mutation();
CREATE TRIGGER content_items_immutable BEFORE UPDATE OR DELETE ON content_items FOR EACH ROW EXECUTE FUNCTION reject_content_registry_mutation();

CREATE TABLE creatures (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  content_hash text NOT NULL, species_id integer NOT NULL, ability_id integer NOT NULL,
  held_item_id integer NOT NULL DEFAULT 0, nickname text NOT NULL CHECK (length(nickname) BETWEEN 1 AND 10),
  personality bigint NOT NULL CHECK (personality BETWEEN 0 AND 4294967295),
  ot_id bigint NOT NULL CHECK (ot_id BETWEEN 0 AND 4294967295), ot_name text NOT NULL CHECK (ot_name ~ '^[A-Z]{1,7}$'),
  level integer NOT NULL CHECK (level BETWEEN 1 AND 100), experience bigint NOT NULL CHECK (experience BETWEEN 0 AND 4294967295),
  friendship integer NOT NULL CHECK (friendship BETWEEN 0 AND 255),
  iv_hp integer NOT NULL CHECK (iv_hp BETWEEN 0 AND 31), iv_attack integer NOT NULL CHECK (iv_attack BETWEEN 0 AND 31),
  iv_defense integer NOT NULL CHECK (iv_defense BETWEEN 0 AND 31), iv_speed integer NOT NULL CHECK (iv_speed BETWEEN 0 AND 31),
  iv_sp_attack integer NOT NULL CHECK (iv_sp_attack BETWEEN 0 AND 31), iv_sp_defense integer NOT NULL CHECK (iv_sp_defense BETWEEN 0 AND 31),
  ev_hp integer NOT NULL CHECK (ev_hp BETWEEN 0 AND 255), ev_attack integer NOT NULL CHECK (ev_attack BETWEEN 0 AND 255),
  ev_defense integer NOT NULL CHECK (ev_defense BETWEEN 0 AND 255), ev_speed integer NOT NULL CHECK (ev_speed BETWEEN 0 AND 255),
  ev_sp_attack integer NOT NULL CHECK (ev_sp_attack BETWEEN 0 AND 255), ev_sp_defense integer NOT NULL CHECK (ev_sp_defense BETWEEN 0 AND 255),
  max_hp integer NOT NULL CHECK (max_hp BETWEEN 1 AND 65535), hp integer NOT NULL CHECK (hp >= 0 AND hp <= max_hp),
  attack integer NOT NULL CHECK (attack BETWEEN 1 AND 65535), defense integer NOT NULL CHECK (defense BETWEEN 1 AND 65535),
  speed integer NOT NULL CHECK (speed BETWEEN 1 AND 65535), sp_attack integer NOT NULL CHECK (sp_attack BETWEEN 1 AND 65535),
  sp_defense integer NOT NULL CHECK (sp_defense BETWEEN 1 AND 65535),
  status text NOT NULL CHECK (status IN ('healthy','poison','burn','sleep','paralysis','freeze','toxic')),
  status_turns integer NOT NULL DEFAULT 0 CHECK (status_turns BETWEEN 0 AND 7),
  location_kind text NOT NULL, box_index integer NOT NULL, slot_index integer NOT NULL,
  provenance_kind text NOT NULL CHECK (provenance_kind IN ('development-fixture','caught','gift','trade')),
  provenance_key text NOT NULL CHECK (length(provenance_key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, content_hash), UNIQUE (owner_id, provenance_key),
  UNIQUE (owner_id, location_kind, box_index, slot_index),
  FOREIGN KEY (content_hash, species_id) REFERENCES content_species(content_hash, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (content_hash, ability_id) REFERENCES content_abilities(content_hash, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (content_hash, held_item_id) REFERENCES content_items(content_hash, source_id) ON DELETE RESTRICT,
  CONSTRAINT creatures_ev_total CHECK (ev_hp + ev_attack + ev_defense + ev_speed + ev_sp_attack + ev_sp_defense <= 510),
  CONSTRAINT creatures_status_turns CHECK ((status = 'sleep' AND status_turns BETWEEN 1 AND 7) OR (status <> 'sleep' AND status_turns = 0)),
  CONSTRAINT creatures_location CHECK ((location_kind = 'party' AND box_index = 0 AND slot_index BETWEEN 1 AND 6)
    OR (location_kind = 'storage' AND box_index BETWEEN 1 AND 14 AND slot_index BETWEEN 1 AND 30))
);
CREATE TABLE creature_moves (
  creature_id uuid NOT NULL, content_hash text NOT NULL, slot_index integer NOT NULL CHECK (slot_index BETWEEN 1 AND 4),
  move_id integer NOT NULL, pp integer NOT NULL CHECK (pp BETWEEN 0 AND 255), pp_ups integer NOT NULL CHECK (pp_ups BETWEEN 0 AND 3),
  PRIMARY KEY (creature_id, slot_index), UNIQUE (creature_id, move_id),
  FOREIGN KEY (creature_id, content_hash) REFERENCES creatures(id, content_hash) ON DELETE RESTRICT,
  FOREIGN KEY (content_hash, move_id) REFERENCES content_moves(content_hash, source_id) ON DELETE RESTRICT
);
CREATE FUNCTION validate_creature_move_pp() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_pp integer;
BEGIN
  SELECT base_pp INTO source_pp FROM content_moves WHERE content_hash = NEW.content_hash AND source_id = NEW.move_id;
  IF source_pp IS NULL OR NEW.pp > source_pp + (source_pp * NEW.pp_ups / 5) THEN
    RAISE EXCEPTION 'Move PP exceeds source definition with PP Ups' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER creature_moves_pp BEFORE INSERT OR UPDATE ON creature_moves FOR EACH ROW EXECUTE FUNCTION validate_creature_move_pp();

CREATE TABLE character_inventory (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  content_hash text NOT NULL, item_id integer NOT NULL CHECK (item_id > 0), pocket text NOT NULL,
  slot_index integer NOT NULL, quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  PRIMARY KEY (character_id, item_id), UNIQUE (character_id, pocket, slot_index),
  FOREIGN KEY (content_hash, item_id, pocket) REFERENCES content_items(content_hash, source_id, pocket) ON DELETE RESTRICT,
  CONSTRAINT character_inventory_capacity CHECK (slot_index >= 1 AND
    ((pocket = 'POCKET_ITEMS' AND slot_index <= 42) OR (pocket = 'POCKET_KEY_ITEMS' AND slot_index <= 30)
    OR (pocket = 'POCKET_POKE_BALLS' AND slot_index <= 13) OR (pocket = 'POCKET_TM_CASE' AND slot_index <= 58)
    OR (pocket = 'POCKET_BERRY_POUCH' AND slot_index <= 43)))
);
CREATE TABLE character_wallets (
  character_id uuid PRIMARY KEY REFERENCES characters(id) ON DELETE RESTRICT,
  money integer NOT NULL CHECK (money BETWEEN 0 AND 999999)
);
CREATE TABLE domain_outcomes (
  id uuid PRIMARY KEY, character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (length(type) BETWEEN 1 AND 100), business_key text NOT NULL CHECK (length(business_key) BETWEEN 1 AND 200),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  content_hash text NOT NULL REFERENCES content_versions(content_hash) ON DELETE RESTRICT,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (character_id, type, business_key), UNIQUE (id, character_id)
);
CREATE TABLE character_flags (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  flag_key text NOT NULL CHECK (length(flag_key) BETWEEN 1 AND 200), set_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (character_id, flag_key)
);
CREATE TABLE character_variables (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  variable_key text NOT NULL CHECK (length(variable_key) BETWEEN 1 AND 200), value integer NOT NULL CHECK (value BETWEEN 0 AND 65535),
  PRIMARY KEY (character_id, variable_key)
);
CREATE TABLE character_claims (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  claim_key text NOT NULL CHECK (length(claim_key) BETWEEN 1 AND 200), domain_outcome_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (character_id, claim_key),
  FOREIGN KEY (domain_outcome_id, character_id) REFERENCES domain_outcomes(id, character_id) ON DELETE RESTRICT
);
CREATE TABLE character_map_patches (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  map_id text NOT NULL CHECK (map_id ~ '^MAP_[A-Z0-9_]+$'), patch_key text NOT NULL CHECK (length(patch_key) BETWEEN 1 AND 200),
  content_hash text NOT NULL REFERENCES content_versions(content_hash) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0), patch jsonb NOT NULL CHECK (jsonb_typeof(patch) = 'object'),
  PRIMARY KEY (character_id, map_id, patch_key)
);
CREATE TABLE character_trainer_completions (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  trainer_key text NOT NULL CHECK (length(trainer_key) BETWEEN 1 AND 200),
  content_hash text NOT NULL REFERENCES content_versions(content_hash) ON DELETE RESTRICT,
  domain_outcome_id uuid NOT NULL, completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (character_id, trainer_key),
  FOREIGN KEY (domain_outcome_id, character_id) REFERENCES domain_outcomes(id, character_id) ON DELETE RESTRICT
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY, character_id uuid NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  domain_outcome_id uuid NOT NULL, event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (domain_outcome_id, character_id) REFERENCES domain_outcomes(id, character_id) ON DELETE RESTRICT
);
CREATE FUNCTION reject_outcome_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Committed outcomes and audit events are immutable' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER domain_outcomes_immutable BEFORE UPDATE ON domain_outcomes FOR EACH ROW EXECUTE FUNCTION reject_outcome_update();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_outcome_update();
