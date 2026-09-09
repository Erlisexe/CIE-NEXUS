"use client";

import { ShieldAlert } from "lucide-react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";
import Link from "next/link";

export default function PendingAccessPage() {
  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    window.location.replace("/login");
  }
  return <main className="auth-page single"><section className="auth-card registration-card">
    <div className="auth-card-icon warning"><ShieldAlert size={23}/></div>
    <p className="section-kicker">Acceso restringido</p>
    <h1>La cuenta no está habilitada</h1>
    <p>Tu identidad fue verificada, pero no existe una autorización activa en CIE Nexus. Solicita a la administración que revise el correo, rol y asignaciones.</p>
    <button className="auth-primary" onClick={signOut}>Cerrar sesión</button>
    <Link className="auth-secondary" href="/formacion">Ir al campus público</Link>
  </section></main>;
}
