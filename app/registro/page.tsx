"use client";

import { CheckCircle2, LoaderCircle, UserRoundPlus } from "lucide-react";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

export default function RegistrationPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password.length < 10) return setMessage("La contraseña debe tener al menos 10 caracteres.");
    if (password !== confirmation) return setMessage("Las contraseñas no coinciden.");
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setMessage("No fue posible activar la cuenta. Verifica que el correo sea correcto o intenta iniciar sesión.");
      return;
    }
    if (data.session) {
      const access = await fetch("/api/auth/me", { cache: "no-store" });
      if (access.ok) return window.location.replace("/");
      await supabase.auth.signOut();
      setMessage("Este correo no fue autorizado previamente por la administración.");
      return;
    }
    setSuccess(true);
  }

  return <main className="auth-page single">
    <section className="auth-card registration-card" aria-labelledby="registration-title">
      <div className="auth-card-icon">{success ? <CheckCircle2 size={23}/> : <UserRoundPlus size={23}/>}</div>
      <p className="section-kicker">Activación de cuenta</p>
      <h1 id="registration-title">{success ? "Revisa tu correo" : "Crea tu contraseña"}</h1>
      {success ? <>
        <p>Enviamos un enlace de confirmación. Después de verificar el correo podrás entrar con los permisos que te asignó la administración.</p>
        <Link className="auth-primary" href="/login">Volver al inicio de sesión</Link>
      </> : <>
        <p>Solo se habilitarán correos que ya fueron registrados por la administración de CIE Nexus.</p>
        <form onSubmit={submit}>
          <label><span>Correo autorizado</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)}/></label>
          <label><span>Nueva contraseña</span><input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(event) => setPassword(event.target.value)}/><small>Mínimo 10 caracteres.</small></label>
          <label><span>Confirmar contraseña</span><input type="password" autoComplete="new-password" required minLength={10} value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>
          {message && <div className="auth-message" role="alert">{message}</div>}
          <button className="auth-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : null}Activar cuenta</button>
        </form>
        <Link className="auth-secondary" href="/login">Ya tengo una cuenta</Link>
      </>}
    </section>
  </main>;
}
