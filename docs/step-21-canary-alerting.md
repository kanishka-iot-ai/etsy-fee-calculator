# Step 21 — Production Canary Alerting Audit

## 1. Executive Summary
This audit inspects the failure notification and alerting pathway for the scheduled hourly ShopProfit synthetic canary (`.github/workflows/production-canary.yml`).

The system uses **native GitHub Actions failure alerting**, which provides instant, zero-cost, privacy-preserving notification to the repository maintainer without requiring external webhooks, third-party infrastructure, or secret tokens.

---

## 2. GitHub Notification Architecture & Scheduled Workflow Behavior

### Native Scheduled Failure Delivery
- In GitHub Actions, when a scheduled workflow (`cron`) fails, GitHub automatically emits an alert event.
- **Recipient:** By default, GitHub sends the failure notification to the account that committed or last modified the workflow file (`kanishka-iot-ai`).
- **Channel:** Notifications are delivered via GitHub Web Inbox (`https://github.com/notifications`) and to the maintainer's primary GitHub email address (subject to account preferences).
- **Default Account Posture:** New and standard GitHub accounts have email notifications enabled for failed workflows by default.

---

## 3. Workflow Failure Visibility & Diagnostic Surface

When an assertion in `scripts/production-canary.mjs` fails:
1. **GitHub Annotation:** The runner encounters `::error::ShopProfit production canary FAILED` and attaches an immediate high-visibility error annotation to the run summary.
2. **Process Termination:** The script exits with non-zero exit code `1` (`process.exit(1)`), failing the `Run Production Synthetic Canary` step.
3. **Run Status:** The Actions job `Verify Live Production API` fails, coloring the run indicator red with an 'X'.
4. **Log Diagnostic:** The exact failure message is rendered prominently in the build log:
   ```
   ::error::ShopProfit production canary FAILED
   CANARY ERROR: <exact failure description>
   Steps Completed: {"health":...,"version":..., ...}
   ```
5. **Run History:** The run record is retained in the repository's Actions history for 90 days.

---

## 4. Simplest Alert Path & Zero-Cost Evaluation

Native GitHub Actions notification is the recommended and simplest path:
- **No Third-Party Services:** Eliminates Slack, Discord, Telegram, PagerDuty, or SendGrid webhooks.
- **Zero Attack Surface:** No inbound or outbound webhook credentials, no tokens to rotate or leak.
- **Zero Cost:** Free tier on GitHub includes unlimited public repository Actions minutes and standard notifications.
- **Direct Linkage:** The notification email contains a direct link to the exact failed GitHub Actions run and step log.

---

## 5. Verified User-Side GitHub Notification Settings

The user configuration was visually inspected and verified:
- **Default notification email:** `kanishka.bmchak@gmail.com` (active)
- **Actions Notifications:** Configured to `on GitHub, Email. (Failed workflows only)` (active)
- **Repository Watching Subscriptions:** Configured to `on GitHub, Email` (active)

Because `Actions` is explicitly configured to deliver emails on failed workflows to an active inbox, no additional configuration changes are required on the user side. Any canary failure will immediately trigger an email alert and GitHub notification.

---

## 6. Security and Privacy Invariants

- **No Secrets Required:** The canary and notification mechanism require zero repository secrets.
- **No Token Exposure:** No `ADMIN_API_KEY`, `ADMIN_KEY`, or Cloudflare credentials are used or stored.
- **No Data Harvesting:** Zero user data, client telemetry, or IP addresses are transmitted or stored.
- **No Third-Party Tracking:** Monitoring is strictly contained within GitHub Actions and Cloudflare Worker public endpoints.
- **Permissions:** GitHub Actions permissions remain strictly scoped to `contents: read`.

---

## 7. Production Safety Baseline

All production systems remain completely unchanged and operational:
- **Pages:** Untouched (Deployment `681f4e6b`, `https://shopprofitcalculator.com/`).
- **Worker:** Untouched (Deployment `73858135-0a40-4eef-befa-4187e65534d0`).
- **Cloudflare D1:** Untouched (`shopprofit-fees-db`, zero mutations).
- **DNS:** Untouched (Custom domain routes active).
- **Cloudflare Cron:** Untouched (`0 8 * * *`).
- **Active Fee Release:** `v1.1.1` (62 markets, source hash `44526eef...`).
- **Fee Rules & Engine:** Untouched.
