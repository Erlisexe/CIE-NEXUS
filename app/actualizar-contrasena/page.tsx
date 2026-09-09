"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 10) return setMessage("La contraseña debe tener al menos 10 caracteres.");
    if (password !== confirmation) return setMessage("Las contraseñas no coinciden.");
    setBusy(true);
    const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage("El enlace ya no es válido. Solicita una nueva recuperación.");
    window.location.replace("/");
  }
  return <main className="auth-page single"><section className="auth-card registration-card">
    <div className="auth-card-icon"><LockKeyhole size={23}/></div>
    <p className="section-kicker">Seguridad de la cuenta</p><h1>Define una nueva contraseña</h1>
    <form onSubmit={submit}>
      <label><span>Nueva contraseña</span><input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)}/></label>
      <label><span>Confirmar contraseña</span><input type="password" autoComplete="new-password" minLength={10} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>
      {message && <div className="auth-message" role="alert">{message}</div>}
      <button className="auth-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : null}Guardar contraseña</button>
    </form>
  </section></main>;
}

