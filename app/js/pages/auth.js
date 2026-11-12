import { sb, state, loadTeams, setTeam, api } from "../lib/sb.js";
import { esc, icon, toast, errToast, confirmModal, $ } from "../lib/ui.js";
import { MARK } from "../lib/icons.js";

const LOGO = `<a href="/" data-native><img src="/assets/logo.svg" width="96" height="18" alt="Delivrie"></a>`;
function layout(root, inner) {
  root.innerHTML = `<div class="auth"><header class="auth-head">${LOGO}</header><main class="auth-body"><div class="auth-card">${inner}</div></main>
    <footer class="auth-foot"><span>© ${new Date().getFullYear()} Delivrie</span><a href="/help" data-native>Status</a><a href="/docs">Privacy</a><a href="/docs">Terms</a></footer></div>`;
  return root.querySelector(".auth-card");
}
const mark = `<div class="mark">${MARK.replace('width="26" height="19"', 'width="34" height="25"')}</div>`;
function setBusy(btn, busy, label) { btn.disabled = busy; btn.innerHTML = busy ? `<span class="spinner"></span>` : label; }
const pwField = (name, label, ph = "••••••••", hint = "") => `<div class="field"><label for="${name}">${label}</label><div class="input-wrap"><input class="input" id="${name}" name="${name}" type="password" placeholder="${ph}" autocomplete="${name === "password" ? "current-password" : "new-password"}" required><button type="button" class="ibtn trail" data-eye title="Show password">${icon("eye", 14)}</button></div>${hint}</div>`;
function bindEye(card) { card.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", () => { const i = b.parentElement.querySelector("input"); i.type = i.type === "password" ? "text" : "password"; b.innerHTML = icon(i.type === "password" ? "eye" : "eye-off", 14); })); }
async function oauth(provider) {
  localStorage.setItem("dlv_last_method", provider);
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/confirm` } });
  if (error) errToast(new Error(error.message.includes("not enabled") ? `${provider === "github" ? "GitHub" : "Google"} sign-in isn't enabled yet. Use email and password.` : error.message));
}
function sso(last) {
  const lu = (p) => last === p ? '<span class="last-used">Last used</span>' : "";
  return `<div class="sso"><button class="btn btn-secondary" style="position:relative" data-oauth="google">${icon("google", 14)} Continue with Google${lu("google")}</button><button class="btn btn-secondary" style="position:relative" data-oauth="github">${icon("github", 14)} Continue with GitHub${lu("github")}</button></div><div class="or">or</div>`;
}
function bindSso(card) { card.querySelectorAll("[data-oauth]").forEach((b) => b.addEventListener("click", () => oauth(b.dataset.oauth))); }

async function afterLogin(ctx) {
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") return ctx.navigate("/mfa");
  const { data } = await sb.auth.getSession();
  state.session = data.session; state.user = data.session?.user;
  await loadTeams();
  ctx.navigate(ctx.query.next || (state.team ? "/emails" : "/new-team"));
}

export async function signup(ctx) {
  document.title = "Create account · Delivrie";
  const card = layout(ctx.root, `${mark}<h1>Create a Delivrie account</h1><p class="sub">Already have an account? <a href="/login">Log in</a></p>${sso()}
    <form novalidate><div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" placeholder="you@company.com" autocomplete="email" required></div>
    ${pwField("password_new", "Password", "••••••••", '<div class="hint">At least 10 characters.</div>')}
    <button class="btn btn-primary btn-lg btn-block" type="submit">Create account</button></form>
    <p class="legal">By signing up, you agree to our <a href="/docs">Terms of Service</a> and <a href="/docs">Privacy Policy</a>.</p>`);
  bindEye(card); bindSso(card);
  card.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = card.querySelector("#email").value.trim(), password = card.querySelector("#password_new").value;
    if (password.length < 10) return toast("Use at least 10 characters for your password", "err");
    const btn = e.target.querySelector("button[type=submit]"); setBusy(btn, true);
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/confirm` } });
    setBusy(btn, false, "Create account");
    if (error) return errToast(error);
    localStorage.setItem("dlv_last_method", "email");
    if (data.session) return afterLogin(ctx); // email confirmation disabled
    ctx.navigate(`/verify?email=${encodeURIComponent(email)}`);
  });
}

export async function verify(ctx) {
  const email = ctx.query.email || "";
  const domain = email.split("@")[1] || "";
  const inbox = /gmail|googlemail/.test(domain) ? ["Open Gmail", "https://mail.google.com"] : /outlook|hotmail|live/.test(domain) ? ["Open Outlook", "https://outlook.live.com"] : /yahoo/.test(domain) ? ["Open Yahoo Mail", "https://mail.yahoo.com"] : null;
  const card = layout(ctx.root, `${mark}<h1>Check your email</h1><p class="sub">We sent a verification link to <b style="color:var(--fg);font-weight:500">${esc(email)}</b>. It expires in 24 hours.</p>
    ${inbox ? `<a class="btn btn-secondary btn-lg btn-block" href="${inbox[1]}" target="_blank" rel="noopener">${icon("mail", 14)} ${inbox[0]}</a>` : ""}
    <p class="sub" style="font-size:12.5px">Didn’t get it? <a href="#" data-resend>Resend email</a></p>`);
  card.querySelector("[data-resend]").addEventListener("click", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${location.origin}/confirm` } });
    error ? errToast(error) : toast("Verification email sent");
  });
}

export async function confirm(ctx) {
  // Supabase lands here with ?code= (PKCE) or #access_token; detectSessionInUrl handles the exchange.
  const card = layout(ctx.root, `${mark}<h1>Confirm your account</h1><p class="sub" data-msg>Finishing sign-in…</p><button class="btn btn-primary btn-lg btn-block" data-go disabled>Confirm account</button><p class="legal">Trouble confirming? Email <a class="y" href="mailto:support@delivrie.com">support@delivrie.com</a></p>`);
  const err = ctx.query.error_description || new URLSearchParams(location.hash.slice(1)).get("error_description");
  let session = null;
  for (let i = 0; i < 20 && !session && !err; i++) { session = (await sb.auth.getSession()).data.session; if (!session) await new Promise((r) => setTimeout(r, 250)); }
  const msg = card.querySelector("[data-msg]"), btn = card.querySelector("[data-go]");
  if (!session) { msg.textContent = err || "This link is invalid or has expired. Log in or request a new link."; btn.textContent = "Back to log in"; btn.disabled = false; btn.onclick = () => ctx.navigate("/login"); return; }
  msg.innerHTML = `Click below to confirm <b style="color:var(--fg);font-weight:500">${esc(session.user.email)}</b> and finish setting up your workspace.`;
  btn.disabled = false;
  btn.onclick = async () => {
    setBusy(btn, true);
    state.session = session; state.user = session.user;
    // accept a pending invite carried through sign-up
    const inv = localStorage.getItem("dlv_invite");
    if (inv) { localStorage.removeItem("dlv_invite"); await sb.rpc("accept_invite", { invite_token: inv }); }
    await loadTeams();
    if (state.team) { toast("Account confirmed. Welcome to Delivrie"); ctx.navigate("/onboarding"); }
    else ctx.navigate("/new-team?welcome=1");
  };
}

export async function login(ctx) {
  document.title = "Log in · Delivrie";
  const last = localStorage.getItem("dlv_last_method");
  const card = layout(ctx.root, `${mark}<h1>Log in to Delivrie</h1><p class="sub">Don’t have an account? <a href="/signup">Sign up</a></p>${sso(last)}
    <form novalidate style="position:relative">${last === "email" ? '<span class="last-used" style="top:-8px">Last used</span>' : ""}<div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" placeholder="you@company.com" autocomplete="email" required></div>
    <div class="field"><div class="row-flex" style="justify-content:space-between"><label for="password" class="label">Password</label><a href="/reset" class="dim" style="font-size:12px">Forgot password?</a></div><div class="input-wrap"><input class="input" id="password" type="password" placeholder="••••••••" autocomplete="current-password"><button type="button" class="ibtn trail" data-eye>${icon("eye", 14)}</button></div></div>
    <button class="btn btn-primary btn-lg btn-block" type="submit">Log in</button></form>
    <p class="legal">By signing up, you agree to our <a href="/docs">Terms of Service</a> and <a href="/docs">Privacy Policy</a>.</p>`);
  bindEye(card); bindSso(card);
  if (ctx.query.deleted) toast("Your account has been deleted");
  card.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]"); setBusy(btn, true);
    const { error } = await sb.auth.signInWithPassword({ email: card.querySelector("#email").value.trim(), password: card.querySelector("#password").value });
    setBusy(btn, false, "Log in");
    if (error) { card.querySelector("#password").classList.add("error"); return toast(/confirm/i.test(error.message) ? "Confirm your email first. Check your inbox for the link." : "Invalid email or password. Try again or reset it.", "err"); }
    localStorage.setItem("dlv_last_method", "email");
    afterLogin(ctx);
  });
}

export async function mfa(ctx) {
  const card = layout(ctx.root, `${mark}<h1>Two-factor authentication</h1><p class="sub">Enter the 6-digit code from your authenticator app.</p>
    <div class="otp">${Array.from({ length: 6 }, (_, i) => `<input inputmode="numeric" maxlength="1" data-i="${i}" aria-label="Digit ${i + 1}">`).join("")}</div>
    <button class="btn btn-primary btn-lg btn-block" data-go>Continue</button>
    <p class="sub" style="font-size:12.5px"><a href="#" data-rec>Use a recovery code</a> · <a href="#" data-back>Back to log in</a></p>`);
  const ins = [...card.querySelectorAll(".otp input")];
  ins[0].focus();
  ins.forEach((inp, i) => {
    inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(-1); if (inp.value && ins[i + 1]) ins[i + 1].focus(); if (ins.every((x) => x.value)) go(); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !inp.value && ins[i - 1]) ins[i - 1].focus(); });
    inp.addEventListener("paste", (e) => { const t = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6); if (t.length === 6) { e.preventDefault(); t.split("").forEach((c, n) => ins[n].value = c); go(); } });
  });
  const btn = card.querySelector("[data-go]");
  async function go() {
    const code = ins.map((x) => x.value).join("");
    if (code.length !== 6) return;
    setBusy(btn, true);
    const { data: f } = await sb.auth.mfa.listFactors();
    const factor = f?.totp?.find((x) => x.status === "verified");
    if (!factor) { setBusy(btn, false, "Continue"); return afterLogin(ctx); }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(btn, false, "Continue");
    if (error) { ins.forEach((x) => x.value = ""); ins[0].focus(); return toast("That code didn't work. Try the latest one.", "err"); }
    afterLogin(ctx);
  }
  btn.addEventListener("click", go);
  card.querySelector("[data-rec]").addEventListener("click", (e) => { e.preventDefault(); toast("Lost your authenticator? Contact support@delivrie.com from your account email and we'll verify you.", "info", 6000); });
  card.querySelector("[data-back]").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); ctx.navigate("/login"); });
}

export async function reset(ctx) {
  const card = layout(ctx.root, `${mark}<h1>Reset your password</h1><p class="sub">Enter the email on your account and we’ll send you a reset link.</p>
    <form novalidate><div class="field"><label for="email">Email</label><input class="input" id="email" type="email" placeholder="you@company.com" autocomplete="email"></div>
    <button class="btn btn-primary btn-lg btn-block" type="submit">Send reset link</button></form><p class="sub"><a href="/login">Back to log in</a></p>`);
  card.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); setBusy(btn, true);
    const { error } = await sb.auth.resetPasswordForEmail(card.querySelector("#email").value.trim(), { redirectTo: `${location.origin}/reset/new` });
    setBusy(btn, false, "Send reset link");
    error ? errToast(error) : toast("Check your email for a reset link");
  });
}

export async function resetNew(ctx) {
  const card = layout(ctx.root, `${mark}<h1>Set a new password</h1><p class="sub">Must be at least 10 characters and different from your last one.</p>
    <form novalidate>${pwField("pw1", "New password")}${pwField("pw2", "Confirm new password")}<div class="hint" data-match></div>
    <button class="btn btn-primary btn-lg btn-block" type="submit" disabled>Update password</button></form>`);
  bindEye(card);
  const p1 = card.querySelector("#pw1"), p2 = card.querySelector("#pw2"), m = card.querySelector("[data-match]"), btn = card.querySelector("button[type=submit]");
  const check = () => { const ok = p1.value.length >= 10 && p1.value === p2.value; m.innerHTML = p2.value ? (p1.value === p2.value ? `<span style="color:var(--green-2)">${icon("check", 12)}</span> Passwords match` : "Passwords don’t match") : ""; m.style.display = "flex"; m.style.gap = "6px"; btn.disabled = !ok; };
  p1.addEventListener("input", check); p2.addEventListener("input", check);
  card.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault(); setBusy(btn, true);
    const { error } = await sb.auth.updateUser({ password: p1.value });
    setBusy(btn, false, "Update password");
    if (error) return errToast(error);
    toast("Password updated");
    afterLogin(ctx);
  });
}

export async function newTeam(ctx) {
  const card = layout(ctx.root, `${mark}<h1>Create a new team</h1><p class="sub">Your account isn’t part of a team yet. Create one to start sending, or delete the account for good.</p>
    <form novalidate><div class="field"><label for="tn">Team name</label><input class="input" id="tn" placeholder="Kora" autocomplete="organization"></div><button class="btn btn-primary btn-lg btn-block" type="submit">Create team</button></form>
    <button class="btn btn-secondary btn-lg btn-block" data-del>Delete account</button><p class="sub"><a href="#" data-out>Back to log in</a></p>`);
  card.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = card.querySelector("#tn").value.trim();
    if (!name) return toast("Name your team", "err");
    const btn = e.target.querySelector("button"); setBusy(btn, true);
    const { data, error } = await sb.rpc("create_team", { team_name: name });
    if (error) { setBusy(btn, false, "Create team"); return errToast(error); }
    await loadTeams(); setTeam(data);
    toast(ctx.query.welcome ? "Account confirmed. Welcome to Delivrie" : "Team created");
    ctx.navigate("/onboarding");
  });
  card.querySelector("[data-del]").addEventListener("click", async () => {
    const ok = await confirmModal({ title: "Delete account", desc: "This is permanent. Your profile, sessions and connected logins are removed and can’t be recovered.", confirm: "Delete account", typed: "DELETE" });
    if (!ok) return;
    try { await api("DELETE", "/account"); await sb.auth.signOut(); ctx.navigate("/login?deleted=1"); } catch (e) { errToast(e); }
  });
  card.querySelector("[data-out]").addEventListener("click", async (e) => { e.preventDefault(); await sb.auth.signOut(); ctx.navigate("/login"); });
}

export async function invite(ctx) {
  const card = layout(ctx.root, `${mark}<h1>Join a team</h1><p class="sub" data-msg>Loading invite…</p><div data-act style="display:flex;flex-direction:column;gap:8px"></div>`);
  const msg = card.querySelector("[data-msg]"), act = card.querySelector("[data-act]");
  let info;
  try { info = await fetch(`/api/public/invite?token=${encodeURIComponent(ctx.params.token)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message); return j; }); }
  catch (e) { msg.textContent = e.message; act.innerHTML = `<a class="btn btn-secondary btn-lg" href="/login">Back to log in</a>`; return; }
  msg.innerHTML = `You’ve been invited to <b style="color:var(--fg);font-weight:500">${esc(info.team)}</b> as ${info.role === "admin" ? "an Admin" : "a Member"}. Sign in as <b style="color:var(--fg);font-weight:500">${esc(info.email)}</b> to accept.`;
  const { data } = await sb.auth.getSession();
  if (data.session) {
    act.innerHTML = `<button class="btn btn-primary btn-lg" data-accept>Accept invite</button>`;
    act.querySelector("[data-accept]").onclick = async (e) => {
      setBusy(e.target, true);
      const { data: teamId, error } = await sb.rpc("accept_invite", { invite_token: ctx.params.token });
      if (error) { setBusy(e.target, false, "Accept invite"); return errToast(error); }
      state.user = data.session.user; await loadTeams(); setTeam(teamId); toast(`You joined ${info.team}`); ctx.navigate("/emails");
    };
  } else {
    localStorage.setItem("dlv_invite", ctx.params.token);
    act.innerHTML = `<a class="btn btn-primary btn-lg" href="/signup">Create account</a><a class="btn btn-secondary btn-lg" href="/login?next=${encodeURIComponent(location.pathname)}">Log in</a>`;
  }
}
