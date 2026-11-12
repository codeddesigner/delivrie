import { sb, state, loadTeams, setTeam, api } from "../lib/sb.js";
import { esc, icon, toast, errToast, confirmModal, $ } from "../lib/ui.js";
import { MARK } from "../lib/icons.js";
import { nextAfterAuth, takeNext } from "../lib/intent.js";

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
  ctx.navigate(nextAfterAuth());
}

export async function signup(ctx) {
  document.title = "Create account · Delivrie";
  const card = layout(ctx.root, `${mark}<h1>Create a Delivrie account</h1><p class="sub">Already have an account? <a href="/login${location.search}">Log in</a></p>${sso()}
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
    const { data, error } = await sb.auth.signUp({ email, password });
    setBusy(btn, false, "Create account");
    if (error) return errToast(error);
    localStorage.setItem("dlv_last_method", "email");
    if (data.session) return afterLogin(ctx); // email confirmation disabled
    ctx.navigate(`/verify?type=signup&email=${encodeURIComponent(email)}`);
  });
}

// One screen for every emailed code: sign-up confirmation, sign-in code and password reset.
const CODE_FLOWS = {
  signup: { title: "Check your email", sub: "Enter the code we sent to confirm your account.", resend: (email) => sb.auth.resend({ type: "signup", email }) },
  email: { title: "Check your email", sub: "Enter the sign-in code we sent you.", resend: (email) => sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }) },
  recovery: { title: "Check your email", sub: "Enter the code we sent to reset your password.", resend: (email) => sb.auth.resetPasswordForEmail(email) },
};
export async function verify(ctx) {
  const email = ctx.query.email || "";
  const type = CODE_FLOWS[ctx.query.type] ? ctx.query.type : "signup";
  const flow = CODE_FLOWS[type];
  document.title = "Enter your code · Delivrie";
  const domain = email.split("@")[1] || "";
  const inbox = /gmail|googlemail/.test(domain) ? ["Open Gmail", "https://mail.google.com"] : /outlook|hotmail|live/.test(domain) ? ["Open Outlook", "https://outlook.live.com"] : /yahoo/.test(domain) ? ["Open Yahoo Mail", "https://mail.yahoo.com"] : null;
  const card = layout(ctx.root, `${mark}<h1>${flow.title}</h1><p class="sub">${flow.sub} It went to <b style="color:var(--fg);font-weight:500">${esc(email)}</b>.</p>
    <form novalidate><div class="field"><label for="code">Code</label><input class="input mono" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456" style="letter-spacing:.35em;text-align:center;font-size:20px;height:48px"></div>
    <button class="btn btn-primary btn-lg btn-block" type="submit">Continue</button></form>
    ${inbox ? `<a class="btn btn-secondary btn-lg btn-block" href="${inbox[1]}" target="_blank" rel="noopener">${icon("mail", 14)} ${inbox[0]}</a>` : ""}
    <p class="sub" style="font-size:12.5px">Didn’t get it? Check spam, or <a href="#" data-resend>send a new code</a> · <a href="/login">Back to log in</a></p>`);
  const input = card.querySelector("#code"), form = card.querySelector("form"), btn = form.querySelector("button");
  input.focus();
  input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, ""); input.classList.remove("error"); if (input.value.length === 6) form.requestSubmit(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = input.value.trim();
    if (token.length < 6) return toast("Enter the code from the email", "err");
    setBusy(btn, true);
    const { data, error } = await sb.auth.verifyOtp({ email, token, type });
    setBusy(btn, false, "Continue");
    if (error) { input.classList.add("error"); input.select(); return toast(/expired/i.test(error.message) ? "That code has expired. Send a new one." : "That code didn’t work. Check it and try again.", "err"); }
    state.session = data.session; state.user = data.session?.user;
    localStorage.setItem("dlv_last_method", "email");
    if (type === "recovery") return ctx.navigate("/reset/new", { replace: true });
    if (type === "signup") {
      const inv = localStorage.getItem("dlv_invite");
      if (inv) { localStorage.removeItem("dlv_invite"); await sb.rpc("accept_invite", { invite_token: inv }); }
      await loadTeams();
      const go = nextAfterAuth("/onboarding");
      if (state.team) toast("Account confirmed. Welcome to Delivrie");
      return ctx.navigate(go === "/new-team" ? "/new-team?welcome=1" : go);
    }
    afterLogin(ctx);
  });
  card.querySelector("[data-resend]").addEventListener("click", async (e) => {
    e.preventDefault();
    const { error } = await flow.resend(email);
    error ? errToast(/rate|seconds/i.test(error.message) ? new Error("Wait a minute before asking for another code.") : error) : toast("New code sent");
  });
}

export async function confirm(ctx) {
  // Supabase lands here with ?code= (PKCE) or #access_token; detectSessionInUrl handles the exchange.
  const card = layout(ctx.root, `${mark}<h1>Confirm your account</h1><p class="sub" data-msg>Finishing sign-in…</p><button class="btn btn-primary btn-lg btn-block" data-go disabled>Confirm account</button><p class="legal">Trouble confirming? Email <a class="y" href="mailto:support@delivrie.io">support@delivrie.io</a></p>`);
  let err = ctx.query.error_description || new URLSearchParams(location.hash.slice(1)).get("error_description");
  // Links in Delivrie's auth emails point at delivrie.io/confirm?token_hash=…&type=… (no supabase.co in the URL).
  if (ctx.query.token_hash && ctx.query.type) {
    const { error } = await sb.auth.verifyOtp({ token_hash: ctx.query.token_hash, type: ctx.query.type });
    history.replaceState(null, "", "/confirm");
    if (error) err = /expired|invalid/i.test(error.message) ? "This link is invalid or has expired. Log in or request a new link." : error.message;
    else if (ctx.query.type === "email_change") { toast("Email address updated"); return ctx.navigate("/profile", { replace: true }); }
  }
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
    const go = nextAfterAuth("/onboarding");
    if (state.team) toast("Account confirmed. Welcome to Delivrie");
    ctx.navigate(go === "/new-team" ? "/new-team?welcome=1" : go);
  };
}

export async function login(ctx) {
  document.title = "Log in · Delivrie";
  const last = localStorage.getItem("dlv_last_method");
  const card = layout(ctx.root, `${mark}<h1>Log in to Delivrie</h1><p class="sub">Don’t have an account? <a href="/signup${location.search}">Sign up</a></p>${sso(last)}
    <form novalidate style="position:relative">${last === "email" ? '<span class="last-used" style="top:-8px">Last used</span>' : ""}<div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" placeholder="you@company.com" autocomplete="email" required></div>
    <div class="field"><div class="row-flex" style="justify-content:space-between"><label for="password" class="label">Password</label><a href="/reset" class="dim" style="font-size:12px">Forgot password?</a></div><div class="input-wrap"><input class="input" id="password" type="password" placeholder="••••••••" autocomplete="current-password"><button type="button" class="ibtn trail" data-eye>${icon("eye", 14)}</button></div></div>
    <button class="btn btn-primary btn-lg btn-block" type="submit">Log in</button></form>
    <p class="sub" style="font-size:12.5px;margin-top:-4px"><a href="#" data-code>Email me a sign-in code instead</a> · <a href="#" data-sso>Use single sign-on</a></p>
    <p class="legal">By signing up, you agree to our <a href="/docs">Terms of Service</a> and <a href="/docs">Privacy Policy</a>.</p>`);
  bindEye(card); bindSso(card);
  if (ctx.query.deleted) toast("Your account has been deleted");
  card.querySelector("[data-code]").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = card.querySelector("#email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { card.querySelector("#email").focus(); return toast("Enter your email first", "err"); }
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) return errToast(/signups not allowed|not found/i.test(error.message) ? new Error("No account uses that email. Sign up instead.") : error);
    ctx.navigate(`/verify?type=email&email=${encodeURIComponent(email)}`);
  });
  // Single sign-on (Figma 9.9): teams with SAML set up sign in through their identity provider.
  const ssoFor = async (email) => { const { data } = await sb.rpc("sso_for_email", { p_email: email }); return data?.[0] || null; };
  const startSso = async (domain) => {
    localStorage.setItem("dlv_last_method", "sso");
    const { data, error } = await sb.auth.signInWithSSO({ domain, options: { redirectTo: `${location.origin}/confirm` } });
    if (error) return errToast(error);
    location.href = data.url;
  };
  card.querySelector("[data-sso]").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = card.querySelector("#email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { card.querySelector("#email").focus(); return toast("Enter your work email first", "err"); }
    const s = await ssoFor(email);
    if (!s) return toast(`Single sign-on isn’t set up for ${email.split("@")[1]}. Log in with your password.`, "info", 5000);
    startSso(s.domain);
  });
  card.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]"); setBusy(btn, true);
    const enforced = await ssoFor(card.querySelector("#email").value.trim()).catch(() => null);
    if (enforced?.enforce) { setBusy(btn, false, "Log in"); toast(`${enforced.domain} requires single sign-on. Taking you to your identity provider.`, "info"); return startSso(enforced.domain); }
    const { error } = await sb.auth.signInWithPassword({ email: card.querySelector("#email").value.trim(), password: card.querySelector("#password").value });
    setBusy(btn, false, "Log in");
    if (error && /confirm/i.test(error.message)) {
      const email = card.querySelector("#email").value.trim();
      await sb.auth.resend({ type: "signup", email });
      toast("Confirm your email first. We sent you a new code.", "info");
      return ctx.navigate(`/verify?type=signup&email=${encodeURIComponent(email)}`);
    }
    if (error) { card.querySelector("#password").classList.add("error"); return toast("Invalid email or password. Try again or reset it.", "err"); }
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
  const card = layout(ctx.root, `${mark}<h1>Reset your password</h1><p class="sub">Enter the email on your account and we’ll send you a code.</p>
    <form novalidate><div class="field"><label for="email">Email</label><input class="input" id="email" type="email" placeholder="you@company.com" autocomplete="email"></div>
    <button class="btn btn-primary btn-lg btn-block" type="submit">Send code</button></form><p class="sub"><a href="/login">Back to log in</a></p>`);
  card.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); setBusy(btn, true);
    const email = card.querySelector("#email").value.trim();
    const { error } = await sb.auth.resetPasswordForEmail(email);
    setBusy(btn, false, "Send code");
    if (error) return errToast(error);
    ctx.navigate(`/verify?type=recovery&email=${encodeURIComponent(email)}`);
  });
}

export async function resetNew(ctx) {
  if (ctx.query.token_hash && ctx.query.type === "recovery") {
    const { error } = await sb.auth.verifyOtp({ token_hash: ctx.query.token_hash, type: "recovery" });
    history.replaceState(null, "", "/reset/new");
    if (error) { toast("This reset link is invalid or has expired. Request a new one.", "err", 6000); return ctx.navigate("/reset", { replace: true }); }
  }
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
    ctx.navigate(takeNext() || "/onboarding");
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
