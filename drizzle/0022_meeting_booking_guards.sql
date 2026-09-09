-- Additive protections: no existing records are changed or removed.
CREATE TRIGGER meeting_reservation_insert
BEFORE INSERT ON meeting_requests WHEN NEW.status IN ('pending','accepted')
BEGIN
  SELECT RAISE(ABORT, 'meeting_schedule_conflict') WHERE EXISTS (
    SELECT 1 FROM meeting_requests m WHERE m.status IN ('pending','accepted')
    AND m.meeting_date = NEW.meeting_date AND m.start_time < NEW.end_time AND m.end_time > NEW.start_time
    AND (m.recipient_account_id IN (NEW.recipient_account_id,NEW.requester_account_id)
      OR m.requester_account_id IN (NEW.recipient_account_id,NEW.requester_account_id))
  ) OR EXISTS (
    SELECT 1 FROM session_appointments a WHERE a.status <> 'cancelled'
    AND a.session_date = NEW.meeting_date AND a.start_time < NEW.end_time AND a.end_time > NEW.start_time
    AND a.professional_account_id IN (NEW.recipient_account_id,NEW.requester_account_id)
  );
END;
--> statement-breakpoint
CREATE TRIGGER meeting_reservation_update
BEFORE UPDATE OF recipient_account_id,requester_account_id,meeting_date,start_time,end_time,status ON meeting_requests
WHEN NEW.status IN ('pending','accepted') AND (
  OLD.status NOT IN ('pending','accepted') OR NEW.recipient_account_id IS NOT OLD.recipient_account_id
  OR NEW.requester_account_id IS NOT OLD.requester_account_id OR NEW.meeting_date IS NOT OLD.meeting_date
  OR NEW.start_time IS NOT OLD.start_time OR NEW.end_time IS NOT OLD.end_time)
BEGIN
  SELECT RAISE(ABORT, 'meeting_schedule_conflict') WHERE EXISTS (
    SELECT 1 FROM meeting_requests m WHERE m.id <> NEW.id AND m.status IN ('pending','accepted')
    AND m.meeting_date = NEW.meeting_date AND m.start_time < NEW.end_time AND m.end_time > NEW.start_time
    AND (m.recipient_account_id IN (NEW.recipient_account_id,NEW.requester_account_id)
      OR m.requester_account_id IN (NEW.recipient_account_id,NEW.requester_account_id))
  ) OR EXISTS (
    SELECT 1 FROM session_appointments a WHERE a.status <> 'cancelled'
    AND a.session_date = NEW.meeting_date AND a.start_time < NEW.end_time AND a.end_time > NEW.start_time
    AND a.professional_account_id IN (NEW.recipient_account_id,NEW.requester_account_id)
  );
END;
--> statement-breakpoint
CREATE TRIGGER clinical_meeting_conflict_insert
BEFORE INSERT ON session_appointments WHEN NEW.status <> 'cancelled'
BEGIN
  SELECT RAISE(ABORT, 'meeting_schedule_conflict') WHERE EXISTS (
    SELECT 1 FROM meeting_requests m WHERE m.status IN ('pending','accepted')
    AND m.meeting_date = NEW.session_date AND m.start_time < NEW.end_time AND m.end_time > NEW.start_time
    AND NEW.professional_account_id IN (m.recipient_account_id,m.requester_account_id)
  );
END;
--> statement-breakpoint
CREATE TRIGGER clinical_meeting_conflict_update
BEFORE UPDATE OF professional_account_id,session_date,start_time,end_time,status ON session_appointments
WHEN NEW.status <> 'cancelled' AND (OLD.status = 'cancelled'
  OR NEW.professional_account_id IS NOT OLD.professional_account_id OR NEW.session_date IS NOT OLD.session_date
  OR NEW.start_time IS NOT OLD.start_time OR NEW.end_time IS NOT OLD.end_time)
BEGIN
  SELECT RAISE(ABORT, 'meeting_schedule_conflict') WHERE EXISTS (
    SELECT 1 FROM meeting_requests m WHERE m.status IN ('pending','accepted')
    AND m.meeting_date = NEW.session_date AND m.start_time < NEW.end_time AND m.end_time > NEW.start_time
    AND NEW.professional_account_id IN (m.recipient_account_id,m.requester_account_id)
  );
END;
--> statement-breakpoint
CREATE TRIGGER meeting_creation_history
AFTER INSERT ON meeting_requests
BEGIN
  INSERT INTO clinical_data_audit(id,resource_type,resource_id,action,reason,after_snapshot)
  VALUES(lower(hex(randomblob(16))),'meeting_request',NEW.id,'meeting_created','Registro automático de creación.',
    json_object('status',NEW.status,'date',NEW.meeting_date,'startTime',NEW.start_time,'endTime',NEW.end_time));
END;
--> statement-breakpoint
CREATE TRIGGER meeting_status_history
AFTER UPDATE OF status ON meeting_requests WHEN NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO clinical_data_audit(id,resource_type,resource_id,action,reason,before_snapshot,after_snapshot)
  VALUES(lower(hex(randomblob(16))),'meeting_request',NEW.id,'meeting_status_changed','Registro automático de cambio de estado.',
    json_object('status',OLD.status),json_object('status',NEW.status,'date',NEW.meeting_date,'startTime',NEW.start_time,'endTime',NEW.end_time));
END;
