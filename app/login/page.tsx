"use client";

import { KeyRound, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

function safeReturnTo() {
  if (typeof window === "undefined") return "/";
  const value = new URLSearchParams(window.location.search).get("returnTo") || "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const supabase = createSupabaseBrowserClient();
    if (recoveryMode) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/actualizar-contrasena`,
      });
      setBusy(false);
      setMessage(error ? "No fue posible iniciar la recuperación. Revisa el correo." : "Si la cuenta existe, recibirás un enlace para cambiar la contraseña.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setBusy(false);
      setMessage("Correo o contraseña incorrectos.");
      return;
    }
    const access = await fetch("/api/auth/me", { cache: "no-store" });
    if (!access.ok) {
      await supabase.auth.signOut();
      setBusy(false);
      setMessage("La identidad es válida, pero esta cuenta no está autorizada o se encuentra suspendida.");
      return;
    }
    window.location.replace(safeReturnTo());
  }

  return <main className="auth-page">
    <section className="auth-brand-panel">
      <div className="auth-brand-mark"><ShieldCheck size={26}/></div>
      <p className="section-kicker">CIE Nexus</p>
      <h1>Calidad clínica con acceso responsable.</h1>
      <p>Cada profesional trabaja únicamente con las sedes, niños y casos que le fueron asignados.</p>
      <div className="auth-security-note"><LockKeyhole size={19}/><span>Los permisos se verifican nuevamente en cada consulta y modificación.</span></div>
    </section>
    <section className="auth-card" aria-labelledby="login-title">
      <div className="auth-card-icon">{recoveryMode ? <Mail size={23}/> : <KeyRound size={23}/>}</div>
      <p className="section-kicker">Acceso profesional</p>
      <h2 id="login-title">{recoveryMode ? "Recuperar contraseña" : "Iniciar sesión"}</h2>
      <p>{recoveryMode ? "Escribe el correo asociado a tu cuenta." : "Usa el correo autorizado y tu contraseña personal."}</p>
      <form onSubmit={submit}>
        <label><span>Correo electrónico</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@institucion.com"/></label>
        {!recoveryMode && <label><span>Contraseña</span><input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••"/></label>}
        {message && <div className="auth-message" role="status">{message}</div>}
        <button className="auth-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : null}{recoveryMode ? "Enviar enlace" : "Entrar a CIE Nexus"}</button>
      </form>
      <button className="auth-link" onClick={() => { setRecoveryMode(!recoveryMode); setMessage(""); }}>{recoveryMode ? "Volver al inicio de sesión" : "Olvidé mi contraseña"}</button>
      <div className="auth-divider"><span>Primera vez</span></div>
      <Link className="auth-secondary" href="/registro">Activar una cuenta autorizada</Link>
      <Link className="auth-campus-link" href="/formacion">Ir al campus público de Formación</Link>
    </section>
  </main>;
}
