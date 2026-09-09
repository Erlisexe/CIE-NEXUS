export type MobileCapabilities = {
  viewChildren: boolean;
  viewPrograms: boolean;
  viewGraphs: boolean;
  viewCalendar: boolean;
  recordSessions: boolean;
  recordAbc: boolean;
};

export type Bootstrap = {
  apiVersion: string;
  account: {
    id: string;
    displayName: string;
    role: string;
    roleLabel: string;
    siteScope: string[];
  };
  capabilities: MobileCapabilities;
  scope: {
    policy: string;
    activeProfileCount: number;
    upcomingAppointmentCount: number;
  };
};

export type ChildSummary = {
  id: string;
  fullName: string;
  internalCode: string;
  site: string;
  diagnosis: string;
  age: number | null;
  photoUrl: string | null;
  activeProgramCount: number;
};

export type Appointment = {
  id: string;
  profileId: string;
  profileName: string;
  site: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  sessionType: string;
  notes: string;
  status: string;
  canStart: boolean;
};

export type Target = {
  id: string;
  code: string;
  name: string;
  specificObjective: string;
  measurement: string;
  unitLabel: string;
  state: string;
  masteryAchieved: boolean;
  masteredAt: string | null;
};

export type Program = {
  id: string;
  name: string;
  objective: string;
  instructions: string;
  targets: Target[];
  cumulativeMastery: Array<{ id: string; date: string; total: number }>;
};

export type ChildDetail = {
  profile: {
    id: string;
    fullName: string;
    internalCode: string;
    site: string;
    diagnosis: string;
    dateOfBirth: string;
    address: string;
    phone: string;
    guardianName: string;
    guardianPhone: string;
    preferredLanguage: string;
    emergencyContact: string;
    notes: string;
  };
  programs: Program[];
  recentSessions: unknown[];
  sessionNoteTemplates: unknown[];
};

export type ApiEnvelope<T> = {
  data: T;
  meta: { apiVersion: string; serverTime: string };
};

export type ApiFailure = {
  error?: { code?: string; message?: string };
};
