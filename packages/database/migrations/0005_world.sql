-- The only admitted world activity remains a named local development fixture.
ALTER TABLE characters ADD COLUMN position_elevation integer CHECK (position_elevation BETWEEN 0 AND 15);
ALTER TABLE characters ADD COLUMN position_facing text CHECK (position_facing IN ('north','south','west','east'));
ALTER TABLE characters ADD COLUMN transition_generation bigint NOT NULL DEFAULT 0 CHECK (transition_generation BETWEEN 0 AND 9007199254740991);
ALTER TABLE characters ADD COLUMN world_checkpoint_id uuid;
-- Existing offline development fixtures have the audited Pallet anchor. Future seeds write these explicitly.
UPDATE characters SET position_elevation=3,position_facing='south' WHERE stage='development-fixture' AND map_id='MAP_PALLET_TOWN' AND position_x=10 AND position_y=12;
ALTER TABLE characters ADD CONSTRAINT characters_world_location_complete CHECK (
  (map_id IS NULL AND position_elevation IS NULL AND position_facing IS NULL) OR
  (map_id IS NOT NULL AND position_elevation IS NOT NULL AND position_facing IS NOT NULL)
);
ALTER TABLE characters DROP CONSTRAINT characters_development_profile;
ALTER TABLE characters ADD CONSTRAINT characters_development_profile CHECK (stage <> 'development-fixture' OR (activity IN ('recovering','overworld','transferring') AND map_id IS NOT NULL));
ALTER TABLE characters ADD CONSTRAINT characters_world_activity CHECK (activity NOT IN ('overworld','transferring') OR (stage='development-fixture' AND transition_generation>0 AND world_checkpoint_id IS NOT NULL));
