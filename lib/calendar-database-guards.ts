function sqlAlias(value: string) {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw new Error("Alias SQL no válido.");
  return value;
}

export function noAppointmentClinicalEvidenceSql(aliasValue: string) {
  const alias = sqlAlias(aliasValue);
  return `
    ${alias}.clinical_session_run_id IS NULL
    AND ${alias}.intervention_session_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM abc_records abc WHERE abc.appointment_id = ${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM clinical_session_runs run WHERE run.appointment_id = ${alias}.id)
  `;
}

export function appointmentRestoreAvailabilitySql(aliasValue: string) {
  const alias = sqlAlias(aliasValue);
  return `
    AND NOT EXISTS (
      SELECT 1 FROM session_appointments other
      WHERE other.id <> ${alias}.id
        AND other.professional_account_id = ${alias}.professional_account_id
        AND other.session_date = ${alias}.session_date
        AND other.status <> 'cancelled'
        AND other.start_time < ${alias}.end_time
        AND other.end_time > ${alias}.start_time
    )
    AND NOT EXISTS (
      SELECT 1 FROM meeting_requests meeting
      WHERE meeting.status IN ('pending', 'accepted')
        AND meeting.meeting_date = ${alias}.session_date
        AND meeting.start_time < ${alias}.end_time
        AND meeting.end_time > ${alias}.start_time
        AND ${alias}.professional_account_id IN (meeting.recipient_account_id, meeting.requester_account_id)
    )
  `;
}
