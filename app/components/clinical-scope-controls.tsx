"use client";

import { RotateCcw } from "lucide-react";
import type { ClinicalFilter } from "../../lib/clinical-filter";

export default function ClinicalScopeControls({ profiles, sites, filter, onSiteChange, onProfileChange, onClear }: {
  profiles: Array<{ id: string; fullName: string; site: string; status: string }>;
  sites: string[];
  filter: ClinicalFilter;
  onSiteChange: (site: string) => void;
  onProfileChange: (id: string) => void;
  onClear: () => void;
}) {
  const options = profiles.filter((profile) => (profile.status === "active" || profile.id === filter.profileId) && (filter.site === "Todas" || profile.site === filter.site));
  const selected = options.find((profile) => profile.id === filter.profileId);
  return <section className="clinical-scope-controls" aria-label="Filtros clínicos">
    <div className="clinical-scope-fields">
      <label><span>Sede</span><select aria-label="Filtrar por sede" value={filter.site} onChange={(event) => onSiteChange(event.target.value)}><option value="Todas">Todas las sedes</option>{sites.map((site) => <option key={site} value={site}>{site}</option>)}</select></label>
      <label><span>Niño</span><select aria-label="Filtrar por niño" value={filter.profileId} onChange={(event) => onProfileChange(event.target.value)}><option value="all">Todos los niños</option>{filter.profileId !== "all" && !selected && <option value={filter.profileId}>Niño fuera del filtro</option>}{options.map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName}</option>)}</select></label>
      <button type="button" onClick={onClear} disabled={filter.site === "Todas" && filter.profileId === "all"}><RotateCcw size={16}/> Limpiar filtro</button>
    </div>
    <p role="status"><strong>Mostrando:</strong> {filter.site === "Todas" ? "Todas las sedes" : filter.site} · {filter.profileId === "all" ? "Todos los niños de tu alcance" : selected?.fullName || "Niño fuera del filtro"}<span>Niños, citas y datos clínicos</span></p>
  </section>;
}
