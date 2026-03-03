-- Migration: Allow admin to bypass audit trail protection for hard deletes
-- This drops the old strict trigger and creates a new one with admin bypass

-- First, drop the old strict triggers
DROP TRIGGER IF EXISTS prevent_request_activities_delete ON request_activities;
DROP TRIGGER IF EXISTS prevent_request_activities_update ON request_activities;

-- Create new trigger function with admin bypass capability
-- Uses session variable 'app.bypass_audit' to allow admin operations
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if bypass is enabled (set by admin operations)
  IF current_setting('app.bypass_audit', true) = 'true' THEN
    -- Allow the operation for admin hard delete
    RETURN OLD;
  END IF;
  
  -- Otherwise, block modification as before
  RAISE EXCEPTION 'Cannot modify audit trail records (table % is append-only)', TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recreate triggers
CREATE TRIGGER prevent_request_activities_update
BEFORE UPDATE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_request_activities_delete
BEFORE DELETE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();
