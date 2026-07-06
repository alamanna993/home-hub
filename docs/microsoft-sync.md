# Microsoft 365 / Outlook Two-Way Calendar Sync

HomeHub syncs a real Outlook calendar both ways via Microsoft Graph:
Outlook events appear as editable events in HomeHub (sky blue), and events
created in HomeHub (web UI or Telegram bot) land directly on the Outlook
calendar. Edits and deletions flow in both directions. Outlook is the source
of truth for synced events.

## Two connection modes (Settings → Calendar Sync → Ⓜ️)

### 🔑 Client secret (Application permissions) — most reliable
No sign-in flow; HomeHub holds an app credential for your tenant.

Azure portal (portal.azure.com → Microsoft Entra ID → App registrations):
1. New registration (any "supported account types" choice is fine for this mode)
2. Overview page → copy **Application (client) ID** and **Directory (tenant) ID**
3. **API permissions** → Add a permission → Microsoft Graph →
   **Application permissions** → `Calendars.ReadWrite` → Add →
   **Grant admin consent** (Status column must show a green ✓)
4. **Certificates & secrets** → New client secret → copy the **Value**
   column immediately (shown only once; the Secret ID GUID is NOT the secret)
5. In HomeHub fill: client ID, tenant ID, secret Value, and the **email of the
   mailbox** whose calendar to sync → Connect

HomeHub validates before saving: it requests a token with your exact
credentials and then reads the target calendar. Errors are specific
(wrong secret value / missing consent / unknown mailbox).

Trade-off: an app credential with Application permissions can technically
access any mailbox in the tenant. Fine for a self-hosted family server;
rotate the secret in Azure if it ever leaks (they expire anyway — when yours
expires, create a new one and re-connect).

### 📱 Phone sign-in (device code, Delegated permissions)
No secret stored; you approve on a phone; HomeHub keeps a refresh token.
Requires in the app registration:
- Authentication → **Allow public client flows = Yes** (Save bar is at the TOP)
- Supported account types = "any organizational directory + personal
  Microsoft accounts", or paste the Directory (tenant) ID in HomeHub
- API permissions → **Delegated** → `Calendars.ReadWrite`, `offline_access`
  → Grant admin consent

## Error → fix table (each of these was hit in the field)

| Error | Meaning | Fix |
|---|---|---|
| 401 at devicecode / `AADSTS7000218` "must contain client_secret" | App isn't marked as public client | Authentication → Allow public client flows = **Yes** (or Manifest: `"isFallbackPublicClient": true`), or switch to client-secret mode |
| `AADSTS50059` "No tenant-identifying information" | App is single-tenant but HomeHub used /common | Set account types to multi-tenant+personal, or enter the Directory (tenant) ID |
| `AADSTS7000215` invalid client secret | Pasted the Secret **ID** instead of the **Value** | Create a new secret, copy the Value column immediately |
| `AADSTS700016` application not found | Wrong client ID or wrong tenant | Re-copy both from the app's Overview page |
| Calendar check 403 | Token OK, no calendar permission | Application permissions → `Calendars.ReadWrite` → Grant admin consent |
| Calendar check 404 | Mailbox address wrong | Use the full primary email of a real mailbox in the tenant |

A client secret is NEVER used in device-code mode — 7000218 asking for one is
Microsoft's (misleading) way of saying the public-client flag is off.

## How the sync works

- Inbound: `/users/{email}/calendarView` (or `/me` in delegated mode) fetched
  on calendar loads, cached 2 minutes; the calendar page's 🔄 button forces it.
  Window: −30 days … +365 days. Outlook edits update local copies; Outlook
  deletions delete them; new Outlook events are created locally with `ms_id`.
- Outbound: create/edit/delete in HomeHub pushes immediately to Graph
  (best-effort; the local change always succeeds even if Graph is down).
  The Telegram bot's `add_event` pushes too and confirms "synced to Outlook ✓".
- While Graph is connected, any inbound **ICS feed** pointing at
  `outlook.office*` is skipped (no duplicates), and Outlook-origin events are
  excluded from HomeHub's outbound `feed.ics`.

## Where state lives / how to reset

Settings table keys: `msgraph_client_id`, `msgraph_tenant`,
`msgraph_client_secret`, `msgraph_user_email`, `msgraph_refresh_token`,
`msgraph_account`, plus `timezone` (default America/New_York, used for
Graph event times).

Inspect on the server:
```bash
cd ~/home-hub
docker compose exec -T db psql -U homehub homehub -c \
  "SELECT key, left(value,40) FROM settings WHERE key LIKE 'msgraph%';"
```

Disconnect = Settings UI button, or `POST /msgraph/disconnect` (admin) —
clears tokens/secret; synced events remain locally but stop updating.
