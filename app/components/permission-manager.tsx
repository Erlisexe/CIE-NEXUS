"use client";

import { Check, LoaderCircle, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  PERMISSION_CATALOG,
  ROLE_ORDER,
  roleLabel,
  type AppPermission,
  type AppRole,
} from "../../lib/access-control";

type PermissionRow = { role: AppRole; permission_key: AppPermission; allowed: boolean };
const emptyMatrix = (): Record<AppRole, AppPermission[]> => ({ direccion_clinica: [], subdirector: [], supervisor: [], coordinador: [], terapeuta: [] });

export default function PermissionManager({ notify }: { notify: (message: string) => void }) {
  const [matrix, setMatrix] = useState<Record<AppRole, AppPermission[]>>(emptyMatrix);
  const [activeRole, setActiveRole] = useState<AppRole>("subdirector");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const groups = useMemo(() => [...new Set(PERMISSION_CATALOG.map((item) => item.group))], []);

  useEffect(() => {
    fetch("/api/role-permissions", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { permissions?: PermissionRow[]; error?: string } }))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || "No se pudo cargar la matriz de permisos.");
        const next = emptyMatrix();
        for (const row of data.permissions || []) if (row.allowed) next[row.role].push(row.permission_key);
        setMatrix(next);
      })
      .catch((error: Error) => notify(error.message))
      .finally(() => setLoading(false));
  // The initial request belongs to the mounted permissions module.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(permission: AppPermission) {
    if (activeRole === "direccion_clinica") return;
    setMatrix((current) => ({
      ...current,
      [activeRole]: current[activeRole].includes(permission)
        ? current[activeRole].filter((item) => item !== permission)
        : [...current[activeRole], permission],
    }));
  }

  async function save() {
    setSaving(true);
    const response = await fetch("/api/role-permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: activeRole, permissions: matrix[activeRole] }),
    });
    const data = await response.json() as { permissions?: AppPermission[]; error?: string };
    setSaving(false);
    if (!response.ok) return notify(data.error || "No se pudieron guardar los permisos.");
    if (data.permissions) setMatrix((current) => ({ ...current, [activeRole]: data.permissions || [] }));
    notify(`Permisos de ${roleLabel(activeRole)} actualizados.`);
  }

  return <>
    <div className="formation-heading permission-heading"><div><p className="section-kicker">Gobierno de acceso</p><h1>Permisos por rol</h1><p>Define qué puede hacer cada rol. El alcance por sede y niños asignados continúa aplicándose aunque habilites una función.</p></div><button className="primary-formation-button" disabled={loading || saving || activeRole === "direccion_clinica"} onClick={save}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar permisos</button></div>
    <section className="permission-role-tabs" aria-label="Roles de CIE Nexus">{ROLE_ORDER.map((role) => <button key={role} className={activeRole === role ? "active" : ""} onClick={() => setActiveRole(role)}><span>{role === "direccion_clinica" ? <ShieldCheck size={17}/> : <Check size={17}/>}</span><strong>{roleLabel(role)}</strong><small>{role === "direccion_clinica" ? "Protección total" : `${matrix[role].length} permisos`}</small></button>)}</section>
    {loading ? <section className="formation-panel intervention-empty"><LoaderCircle className="spin" size={28}/><strong>Cargando permisos…</strong></section> : <section className="permission-groups">{groups.map((group) => <article className="formation-panel permission-group" key={group}><header><div><p className="section-kicker">Área</p><h2>{group}</h2></div><span>{PERMISSION_CATALOG.filter((item) => item.group === group && matrix[activeRole].includes(item.key)).length}/{PERMISSION_CATALOG.filter((item) => item.group === group).length}</span></header><div>{PERMISSION_CATALOG.filter((item) => item.group === group).map((permission) => {
      const checked = activeRole === "direccion_clinica" || matrix[activeRole].includes(permission.key);
      return <label className={`permission-row ${checked ? "enabled" : ""}`} key={permission.key}><input type="checkbox" checked={checked} disabled={activeRole === "direccion_clinica"} onChange={() => toggle(permission.key)}/><span className="permission-check">{checked ? <Check size={15}/> : null}</span><span><strong>{permission.label}</strong><small>{permission.description}</small></span>{activeRole === "direccion_clinica" && <LockKeyhole size={16}/>}</label>;
    })}</div></article>)}</section>}
    <section className="permission-safeguard"><LockKeyhole size={19}/><div><strong>Dirección Clínica conserva el control estructural.</strong><p>Sus permisos permanecen protegidos para evitar que la institución pierda la capacidad de administrar cuentas o restaurar una configuración.</p></div></section>
  </>;
}
