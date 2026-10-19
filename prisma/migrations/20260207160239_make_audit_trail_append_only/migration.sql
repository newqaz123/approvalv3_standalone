-- Create trigger function to prevent modifications to audit trail
-- This function raises an exception when UPDATE or DELETE is attempted
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Cannot modify audit trail records (table % is append-only)', TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to prevent UPDATE operations on request_activities
-- BEFORE UPDATE ensures the check happens before any data modification
-- FOR EACH ROW applies the trigger to every row being updated
CREATE TRIGGER prevent_request_activities_update
BEFORE UPDATE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();

-- Create trigger to prevent DELETE operations on request_activities
-- BEFORE DELETE ensures the check happens before any data deletion
-- FOR EACH ROW applies the trigger to every row being deleted
CREATE TRIGGER prevent_request_activities_delete
BEFORE DELETE ON request_activities
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_modification();
