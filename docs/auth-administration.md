# Auth administration

Who configures authentication, what they are allowed to configure, and how the
support team gets in without becoming the softest target in the product.

Companion to [authentication.md](./authentication.md), which covers how an
individual actually logs in. This one is about the three surfaces around it.

---

## Three surfaces, three populations

| Surface         | Origin                 | Who                        | Population           |
| --------------- | ---------------------- | -------------------------- | -------------------- |
| Tenant app      | `acme.app.kithena.com` | employees, managers, HR    | thousands per tenant |
| Auth origin     | `auth.app.kithena.com` | the same people, enrolling | thousands            |
| **Back-office** | `admin.kithena.com`    | our CX team                | tens, ever           |

The third one is the dangerous one, and it is dangerous in a way the other two
are not: **it is the only surface that crosses tenants.** Everything else in this
system is protected by row-level security keyed on one tenant id. The back-office
exists precisely to see all of them.

Note also that `admin.kithena.com` is **not** under `app.kithena.com`. That is
deliberate and it is free isolation: a different registrable suffix means a
different RP ID, so a CX passkey is a structurally different credential from an
employee passkey. Neither can be used where the other belongs, and no
configuration mistake can make it so.

---

## Tenant auth policy

HR decides how their employees sign in. That is the right call — a hospital and
a software consultancy have genuinely different answers — and it is what makes
the product sellable into procurement.

But "HR decides" cannot mean "HR decides freely", and the reason is not
paternalism.

### Why there is a floor

Three arguments, in ascending order of how much they will cost you.

**The standard.** [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
requires every AAL2 verifier to offer at least one phishing-resistant option,
deprecates email OTP, and downgrades SMS. Password-only login is AAL1. An HRIS
holding [Article 9](https://gdpr-info.eu/art-9-gdpr/) data is not an AAL1 system.

**The liability.** GDPR Article 32 requires "appropriate technical and
organisational measures" from the **processor**, not only the controller. "The
customer selected that setting" is not a defence you want to test after a breach,
and the setting was one you built and offered.

**The attacker.** Whoever compromises an HR admin's session does not need to
maintain that access the hard way if they can simply switch password login on. A
configurable auth policy is a persistence mechanism unless it is defended as one.
This is the most important of the three and it is covered
[below](#weakening-the-policy-is-an-attack-and-is-treated-as-one).

### The shape

Policy is a Zod contract in `packages/contracts`, and — per `CLAUDE.md` — the
floor is enforced in the **domain layer**, not in the settings screen. The
settings screen is one transport of four, and a rule that lives in a form
validator is a rule that the REST facade, the SCIM adapter and a support script
all ignore.

```
Method                 General staff        Privileged roles
                                            (HR, payroll, admin)
─────────────────────────────────────────────────────────────────
Passkey                always available     always available
OIDC (Google, Entra)   available            available
Password               only with a second   never alone;
                       factor               only alongside a passkey
Mobile OTP             available            never as sole factor
Email OTP / magic link never                never
```

Two rows deserve their reasoning stated rather than assumed.

**Password is permitted, and I would not fight it.** A meaningful share of buyers
will require it, some of them for reasons as mundane as a works council that has
not met yet. Refusing costs deals and wins nothing, because those customers will
buy a competitor whose password support is worse than yours would be. Ship it,
never alone, and never for privileged roles.

**Mobile OTP is better than it looks, in one specific place.** NIST downgraded
SMS and was right to — SIM swap is real, and SMS pumping is a live financial
attack where someone triggers your OTP flow against premium-rate numbers and
takes a cut. But for a warehouse worker with a phone and no company email, the
honest alternative is not a passkey; it is a shared password on a laminated card
by the time clock. Mobile OTP beats that comfortably.

So: **available for general staff, never sufficient alone for privileged roles,
and never the recovery channel for anybody.** Rate-limit by destination country
and cap spend per tenant, or the pumping attack is free money.

### Per-role, not just per-tenant

This is the single most valuable piece of flexibility here, and it is worth
building before most of the others.

Attackers do not target the median employee; they target whoever can approve a
payroll change. A policy that applies uniformly is a policy tuned to the least
capable device in the company, which means it is tuned wrong for the accounts
that matter.

Roles come from OpenFGA, which is already how the org chart is modelled. A
relation like `can_administer` or `can_view_compensation` is exactly the
predicate the policy floor should key on.

---

## When a tenant brings their own

The strongest form of "configurable" is a tenant that configures their way out
entirely. That is a supported mode, not a defeat — see
[Headless](./authentication.md#headless-bringing-your-own-identity).

It interacts with everything in this document, and the interaction is uniform:
**anything enforced by our session layer stops applying, and anything enforced by
our authorization layer keeps applying.** Policy floors, rollout modes and the
session cap are ours to enforce and go away. Support access, impersonation rules,
the redaction list and the audit trail are enforced against the `Principal` and
survive intact, because a Principal minted from a token exchange is the same type
as one minted from a passkey.

The back-office should show the mode on the tenant row. A support agent needs to
know, before they start diagnosing a login problem, whether the login they are
diagnosing happened in a system we can see.

---

## Rollout modes

The reason passwordless migrations fail is that they are switches, and a switch
locks out whoever was on holiday that week.

Borrow the idea from Content Security Policy and give each method three states:

| Mode        | Behaviour                                          |
| ----------- | -------------------------------------------------- |
| `off`       | Not offered                                        |
| `encourage` | Offered, prompted after login, adoption counted    |
| `require`   | Enforced. Anyone without it is routed to enrolment |

HR turns passkeys to `encourage`, watches the number climb, and flips to
`require` when it is high enough to be a support ticket rather than an outage.

Pair it with an **adoption dashboard**: what fraction of employees have a
passkey, who is still password-only, which roles are below the floor. That turns
a security setting into a number HR can be measured on, which is what actually
makes it move. No incumbent in this market does this, and it demos extremely
well.

Effective dating is already a rule in this codebase, so the natural extension is
a **scheduled** policy change: "passkey required from 1 March", entered in
January, with the warning banner appearing automatically in February. `CLAUDE.md`
already demands `effectiveFrom` on everything; this is that rule paying off
somewhere unexpected.

---

## Weakening the policy is an attack, and is treated as one

Making auth configurable creates a new privilege-escalation path that did not
exist when it was hard-coded:

```
compromise one HR admin session
   └─▶ enable password login, tenant-wide
        └─▶ set a password on a dormant account
             └─▶ persistent access that survives the original session being killed
```

Strengthening the policy is a normal edit. **Weakening it is a privileged,
delayed, loud operation:**

- Requires step-up authentication with a phishing-resistant factor. A password
  cannot be used to authorise turning passwords on.
- Requires a **second** HR admin to approve — the same dual control as recovery,
  and the reason for the last-two-admins rule.
- Notifies every admin and every active session immediately.
- Takes effect after a delay — an hour is enough — so a legitimate admin has time
  to notice and cancel.
- Emits a high-severity audit event that appears in the tenant's own log, not
  only in ours.

None of this applies to strengthening. Turning passkeys on should be one click.

---

## The back-office

`admin.kithena.com`. Tens of users, total, all of them ours.

### What it is for

Creating a tenant, provisioning the first HR account, inspecting entitlements and
per-tenant health, replaying dead letters, and supporting HR — which is what
`apps/admin/README.md` already says it is for.

### Its own authentication, and it is stricter than the product's

The back-office population is small, salaried and equipped. Every reason to be
flexible for employees is absent here, so:

- **Hardware-bound passkeys only.** `attestation: direct`, verified against the
  FIDO Metadata Service, restricted to an approved AAGUID list. Not synced
  passkeys — a CX credential should not be in a personal iCloud keychain.
- **No password, no OTP, no consumer IdP.** Not configurable.
- **Short sessions.** An hour idle, a working day absolute.
- **Step-up per tenant opened**, not per session. Reading a second customer's
  data is a new decision.
- Separate session slots from the product, and a separate `svc_admin` role.

### The boundary problem, and the answer

You want the back-office to list every company with its employee count, legal
entities and offices. That data lives in the People module.

**The back-office must not query it.** `.dependency-cruiser.cjs` forbids the
import, and the deeper reason is the one `CLAUDE.md` keeps returning to: a
back-office that reads `people.*` directly is a back-office that breaks the day a
customer runs Time Off standalone against Workday and there is no People schema
to read.

So the company list is a **projection**, built by consuming module events:

```
people.person.hired ────┐
people.person.terminated├──▶ platform.tenant_overview   (a read model)
timeoff.request.*       │      employees, legal entities,
entitlement meters   ───┘      offices, last activity, health
```

Same pattern as any other consumer, no new mechanism, and it degrades correctly:
a tenant with no People module simply shows no employee count, rather than
erroring. The counts are eventually consistent, which for an internal dashboard
is not merely acceptable but preferable — it means a slow back-office query can
never contend with a customer's request path.

### Separation of duties at tenant creation

CX creates the tenant and names the first HR admin. **CX must not be able to
enrol a credential for that account.**

```
CX creates tenant ──▶ names the first HR admin (name, work email)
                        └─▶ enrolment token goes to the HR admin
                             └─▶ HR enrols their own passkey
                                  └─▶ tenant becomes active
```

If CX can both create an account and enrol into it, one compromised CX laptop is
a silent, complete takeover of a new customer — and it looks exactly like normal
onboarding in the logs. Splitting it means the takeover requires compromising the
customer too.

### Several first admins, but only one is required

> **Changed 2026-08-22.** This section argued for *requiring* two administrators
> and the code enforced it. The requirement is now one, at the product owner's
> explicit instruction. The reasoning below is unchanged and is why the wizard
> still says so on the screen where somebody adds a single admin — the risk did
> not go away, it was accepted. `NeedsAnAdmin` in
> `platform/identity/src/tenancy/domain/provision.ts` is what now enforces the
> floor of one.
>
> What that costs, concretely: a company whose single administrator leaves
> before their start date has nobody who can sign in, and HR-mediated recovery
> has no second admin to form a quorum. Recovering such a tenant means an
> operator writing to the database — the path this design exists to avoid.

"The root user" is a tempting shape and the wrong one. CX names _people_, each
gets their own account and their own link, and whoever enrols first is simply
the first to arrive.

That is worth doing for its own sake — a company where one person holds the only
link is a company locked out when that person leaves before their start date —
and it also settles something else for free. The second HR admin has to exist
before the tenant leaves onboarding, or the last-two-admins rule has nothing to
protect and HR-mediated recovery has no quorum. Inviting two or three at the
outset makes that the default rather than a checklist item.

It needs nothing new. `enrolment_token_live_key` is unique per _account_, so
three invited admins are three accounts with one live link each, and re-issuing
any of them still invalidates only that one. What the schema forbids is one
account holding several usable links, which is exactly what it should forbid.

There is no platform-level root user at all, and there should not be. An account
that could act inside every tenant is an account worth stealing more than any
customer's data, and the back-office already reaches what it needs to through
its own audited surface.

---

## Support access

HR can allow or forbid CX from entering their tenant. That is the right control.
Here is what it should be, in a slightly stronger form.

### A standing toggle is the weak version

A boolean that is on for years is a boolean nobody has thought about since
onboarding. It will be on everywhere, and it will be on at the moment it matters.

**Just-in-time access is the strong version:**

```
CX opens a ticket, requests access, states a reason
   └─▶ HR sees it in-app and by email: who, why, which ticket, how long
        └─▶ HR approves for a bounded window (default 60 minutes)
             └─▶ CX gets a scoped, expiring, banner-marked session
                  └─▶ window closes automatically; a second visit asks again
```

Keep the standing toggle as `always / on approval / never`, defaulting to **on
approval**. Customers who want frictionless support set it to `always` knowingly;
enterprise and public-sector buyers will specifically ask for the approval mode
and be delighted it exists.

Retain a genuine break-glass for the case where HR is locked out and cannot
approve anything — dual-controlled on our side, hard-capped in duration, and
reported to the customer afterwards whether or not they ask.

### What an impersonated session can do

`Principal.impersonatedBy` already exists in `auth-kit`, which is the right
shape: impersonation is a property of the principal, so every layer that
authorises anything can see it. Not a flag the UI knows about.

|                                                   |                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Read-only by default**                          | Writing requires a separate, explicitly granted mode                                 |
| **Special-category data is redacted**             | Health, biometric, and anything the classification registry marks `special-category` |
| **Cannot change auth policy**                     | Otherwise support access is a route to permanent access                              |
| **Cannot add or remove admins**                   | Same reason                                                                          |
| **Cannot approve anything**                       | No payroll changes, no leave approvals, no offers                                    |
| **Cannot start another impersonation**            | No chaining                                                                          |
| **Does not consume the employee's session slots** | Support must never evict a real device                                               |
| **Visibly banner-marked**                         | For the CX agent, and in the audit trail                                             |

The redaction row is the one worth pausing on, because it costs almost nothing to
build. `packages/contracts/src/classification.ts` already tags every field, and
`tools/codegen` already walks the registry to emit the Pino redaction paths and
the AI deny list. **The impersonation deny list is a third output of the same
walk.** No hand-maintained list, no field that gets added in 2027 and forgotten,
and it fails closed because an unclassified field fails the build.

### The employee's side of it

Every impersonated session is visible to the tenant — not in a log we would
produce on request, but on a screen HR can open, and on the employee's own
security page:

> A Kithena support agent viewed your record on 4 March, 14:12–14:31,
> for ticket #4821, approved by Priya Raman.

Article 15 gives a data subject the right to know who processed their data. Most
vendors answer that with a support ticket and a PDF a fortnight later. Answering
it with a screen is cheap, and it is the kind of thing that survives contact with
a works council — which, in Germany, is the body that can block your deployment
outright.

---

## Worth building, roughly in order

You asked for suggestions. These are the ones I would actually spend time on,
ranked by value per week of work.

**1. Emergency lockdown.** One button, HR-only, step-up protected: revoke every
session in the tenant. Optionally force re-enrolment. The first thing a company
wants during an incident, and the thing they will remember you had. A day's work
on top of the session table already designed.

**2. The adoption dashboard.** Described above. Turns security posture into a
number, which is what makes it improve. Sells itself in a demo.

**3. Auth events as a real event stream.** Login, failure, policy change,
impersonation, revocation — published to the tenant's SIEM by webhook, and
included in the standard export. Enterprise security teams ask for this in every
questionnaire, and you already have the contracts, the outbox and Redpanda. This
is plumbing you have built, exposed.

**4. Risk-based step-up.** New device, new country, impossible travel from the
last session. The session record already stores what this needs. Start with
notify-only; enforcement can come later once false positives are understood.

**5. Legal-entity-scoped administration.** You mentioned legal entities, and a
group with a Spanish and a German entity will want the Spanish HR admin scoped to
Spain. This is what OpenFGA is for and it is a strong enterprise differentiator —
BambooHR's access levels and Workday's security groups are exactly this feature,
and both are clumsy.

**6. Access review.** A quarterly report: who holds admin, which accounts are
dormant, which are below the policy floor, which passkeys have not been used in
90 days. Auditors ask for it, HR never generates it themselves, and it is a
report over data you already hold.

**7. Offboarding rehearsal.** Given a person, show exactly what termination will
revoke and when. HR trusts deprovisioning far more when they have watched it
explain itself, and it turns your best invisible feature into a visible one.

### Considered and not recommended yet

- **Device trust / MDM posture signals.** Real value, disproportionate effort,
  and it drags you into managing agents.
- **Per-tenant custom OIDC providers beyond Google and Entra.** Wait for SAML in
  Phase 8 rather than building a bespoke provider registry that SAML then
  duplicates.
- **IP allowlists per tenant.** Frequently requested, rarely used correctly,
  and it breaks the deskless case badly. Offer it only when someone insists in
  a contract.
