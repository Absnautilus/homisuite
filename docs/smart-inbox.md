# Smart Inbox

Smart Inbox collega la casella Outlook di una struttura (es. `info@`), legge le
nuove email degli ospiti, prepara con Claude una bozza di risposta basata sulle
informazioni dell'hotel e la mostra allo staff in homisuite. **Nessuna email
parte senza che una persona prema "Invia risposta".**

Modulo Core-native (come Turni): tabelle con `property_id`, RLS su
`has_permission()`, entitlement tramite `property_modules`. Nessuna struttura lo
ha attivo finché non viene abilitato (vedi [Attivazione](#attivazione-per-una-struttura)).

## Flusso

```
Outlook (Posta in arrivo)
   │  Microsoft Graph change notification
   ▼
smart-inbox-webhook ──► smart_inbox_messages (pending)
   │  in background (EdgeRuntime.waitUntil)
   ▼
pipeline: legge l'email da Graph → filtri (OTA, no-reply, newsletter, risposte
automatiche, mittenti esclusi) → Claude (classificazione + bozza, JSON) →
smart_inbox_drafts + bozza di risposta anche in Outlook (cartella Bozze)
   │
   ▼
Staff in homisuite: legge, corregge, "Invia risposta"
   │
   ▼
smart-inbox-actions → Graph (send/reply) → message 'replied'
```

`smart-inbox-maintenance` (da chiamare ogni 30 minuti) rinnova le sottoscrizioni
Graph (scadono dopo ~3 giorni), sblocca messaggi rimasti in `processing` e
ritenta quelli `pending`/`failed` (massimo 3 tentativi).

## Componenti

| Parte | Dove |
|---|---|
| Schema, permessi, RLS | `supabase/migrations/20261107180000_smart_inbox_module.sql` |
| Test pgTAP | `supabase/tests/089_smart_inbox_module.test.sql` |
| Logica condivisa (Graph, Claude, filtri, cifratura) | `supabase/functions/_shared/smart-inbox/` |
| Edge Functions | `smart-inbox-connect`, `smart-inbox-oauth-callback`, `smart-inbox-webhook`, `smart-inbox-actions`, `smart-inbox-maintenance` |
| Interfaccia | `apps/web/src/modules/smart-inbox/` (rotta `/smart-inbox`) |

### Conversazioni e agent

- **Ogni ospite è una conversazione** (`smart_inbox_conversations`): una per
  indirizzo mittente e struttura. Tutte le sue email ci finiscono dentro
  (`smart_inbox_messages.thread_id`), insieme alle risposte già inviate.
- **Ogni persona con `smart_inbox.view` è un agent.** Una conversazione si
  assegna a un agent (`assigned_to`): "Prendi in carico", oppure dal menu
  Agent a un collega. La vista "Assegnate a me" mostra solo i propri ospiti.
  Se l'ospite è seguito da un altro agent, la conversazione lo dice, ma
  chiunque può comunque rispondere.
- Chi risponde a un ospite non assegnato ne diventa l'agent, così la prossima
  email dello stesso ospite arriva alla stessa persona.
- Il database accetta come assegnatario solo un agent della stessa struttura
  (`smart_inbox_is_agent`); chi ha assegnato e quando sono registrati lato
  server. L'elenco degli agent viene da `smart_inbox_agents(property_id)`.
- L'assistente riceve gli ultimi 4 scambi con lo stesso ospite (email e
  risposte inviate), per rispondere in modo coerente con quanto già scritto.

### Permessi

| Capability | Ruoli | Cosa permette |
|---|---|---|
| `smart_inbox.view` | receptionist, manager, property_admin, organization_admin | essere agent: leggere la posta, prendere in carico/assegnare ospiti, modificare/inviare bozze, archiviare |
| `smart_inbox.manage` | manager, property_admin, organization_admin | collegare/scollegare Outlook, impostazioni, informazioni hotel, consumo AI |

Come per gli altri moduli, `membership_permission_grants` può concedere queste
capability a una singola persona.

### Sicurezza

- Il refresh token Microsoft è cifrato (AES-GCM) dalle Edge Functions con
  `SMART_INBOX_TOKEN_KEY` e salvato in `smart_inbox_mailbox_secrets`, tabella
  senza alcuna policy né grant per `anon`/`authenticated`.
- Lo `state` OAuth è firmato (HMAC, scadenza 10 minuti): il callback si fida
  solo di quello per sapere struttura e utente.
- Ogni notifica Graph è verificata con il `clientState` della sottoscrizione
  (confrontato come SHA-256).
- Lo staff può modificare solo il testo della bozza (`body`) e lo stato del
  messaggio verso `dismissed`/`needs_attention`; tutto il resto è scritto dalle
  Edge Functions con il service role.
- Il prompt tratta l'email come dato non fidato (difesa da prompt injection) e
  vieta di inventare informazioni, confermare prenotazioni o gestire pagamenti:
  in quei casi la bozza è prudente e il messaggio finisce in "Da gestire".

### AI

- Modello predefinito `claude-opus-5-5`, effort `medium`
  (`SMART_INBOX_MODEL`, `SMART_INBOX_EFFORT` per cambiarli).
- Il blocco "informazioni hotel" è in prompt caching: le email successive della
  stessa struttura rileggono quella parte a una frazione del prezzo.
- Output strutturato (JSON schema) e fallback server-side sui rifiuti
  (`fallbacks: "default"`).
- Ogni chiamata è registrata in `smart_inbox_ai_usage`; la stima mensile è in
  Smart Inbox → Impostazioni.

## Setup

### 1. App Microsoft (Entra ID)

Una volta sola per tutta la piattaforma, da un tenant Microsoft di homisuite:

1. Entra admin center → **App registrations** → **New registration**.
   - Supported account types: *Accounts in any organizational directory*
     (multitenant).
   - Redirect URI (Web):
     `https://<project-ref>.supabase.co/functions/v1/smart-inbox-oauth-callback`
2. **API permissions** → Microsoft Graph → *Delegated*: `offline_access`,
   `User.Read`, `Mail.ReadWrite`, `Mail.Send`.
3. **Certificates & secrets** → nuovo client secret (annotare la scadenza: va
   rinnovato prima che scada).

Alcuni tenant degli hotel richiedono il consenso di un amministratore per le
app esterne: in quel caso il loro IT approva l'app al primo collegamento.

### 2. Secret delle Edge Functions

```bash
supabase secrets set \
  ANTHROPIC_API_KEY=... \
  SMART_INBOX_MS_CLIENT_ID=... \
  SMART_INBOX_MS_CLIENT_SECRET=... \
  SMART_INBOX_TOKEN_KEY="$(openssl rand -base64 32)" \
  SMART_INBOX_STATE_SECRET="$(openssl rand -base64 48)" \
  SMART_INBOX_CRON_SECRET="$(openssl rand -base64 32)" \
  SMART_INBOX_APP_URL=https://<dominio-app-homisuite> \
  --project-ref <project-ref>
```

Facoltativi: `SMART_INBOX_MS_TENANT` (default `organizations`),
`SMART_INBOX_MODEL`, `SMART_INBOX_EFFORT` (`low`/`medium`/`high`),
`SMART_INBOX_FUNCTIONS_URL` (se le funzioni sono dietro un dominio diverso da
`SUPABASE_URL/functions/v1`).

**Non perdere `SMART_INBOX_TOKEN_KEY`**: senza, i token salvati non sono più
leggibili e ogni struttura deve ricollegare Outlook.

### 3. Migration e funzioni

- Migration: workflow *deploy-migrations* come per le altre.
- Funzioni: workflow *Deploy Edge Function*, una per volta o `all`. Il webhook
  deve essere online **prima** che qualcuno colleghi una casella: Microsoft lo
  chiama subito per validare la sottoscrizione.

### 4. Manutenzione programmata

Ogni 30 minuti, una `POST` a
`https://<project-ref>.supabase.co/functions/v1/smart-inbox-maintenance` con
header `x-smart-inbox-cron: <SMART_INBOX_CRON_SECRET>`. Ad esempio con
`pg_cron` + `pg_net` (già usati dal progetto per i webhook Housekeeping):

```sql
select cron.schedule(
  'smart-inbox-maintenance',
  '*/30 * * * *',
  $$ select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/smart-inbox-maintenance',
       headers := jsonb_build_object('x-smart-inbox-cron', '<SMART_INBOX_CRON_SECRET>')
     ) $$
);
```

Non è in una migration apposta: il secret non deve finire nel repository.

## Attivazione per una struttura

Decisione commerciale, come per Ristorazione e Turni (service role):

```sql
insert into property_modules (property_id, module_id, enabled)
select '<property-id>', id, true from modules where slug = 'smart_inbox'
on conflict (property_id, module_id) do update set enabled = true;
```

Poi, in homisuite → Smart Inbox:

1. **Impostazioni** → *Collega Outlook* (un manager), accedendo con l'account
   Microsoft 365 della casella da gestire.
2. **Informazioni hotel** → una sezione per argomento (colazione, parcheggio,
   check-in…). L'assistente risponde solo con quello che è scritto qui.
3. **Impostazioni** → firma, tono, mittenti da ignorare.

## Limiti di questa prima versione

- Solo Microsoft 365 / Outlook con login della casella stessa. Le caselle
  condivise (shared mailbox) senza licenza propria richiedono
  `Mail.ReadWrite.Shared`/`Mail.Send.Shared` e la risorsa `users/{id}`: da
  aggiungere.
- Le email arrivate prima del collegamento non vengono importate.
- Le "azioni da organizzare" (transfer, ristorante, richieste) sono solo
  indicate allo staff: Smart Inbox non scrive nelle tabelle di altri moduli
  (`docs/module-integration.md`). Un contratto esplicito verso Transfer /
  Ristorazione / Housekeeping è il passo successivo.
- WhatsApp non è ancora supportato: la pipeline (filtri → Claude → bozza →
  approvazione) è pensata per aggiungere un secondo canale.
