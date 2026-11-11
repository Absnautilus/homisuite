# Smart Inbox

Smart Inbox collega la casella Outlook di una struttura (es. `info@`), legge le
nuove email degli ospiti, prepara con Claude una bozza di risposta basata sulle
informazioni dell'hotel e la mostra allo staff in homisuite. **Nessuna email
parte senza che una persona prema "Invia risposta".**

Modulo Core-native (come Turni): tabelle con `property_id`, RLS su
`has_permission()`, entitlement tramite `property_modules`. Nessuna struttura lo
ha attivo finché non viene abilitato (vedi [Attivazione](#attivazione-per-una-struttura)).

## Componi risposta (canali non collegati)

Per i messaggi che non arrivano da soli — extranet Booking.com/Expedia/Airbnb,
WhatsApp, telefono — lo staff apre **Componi risposta**, sceglie il canale e
incolla il testo dell'ospite. L'assistente:

1. legge i dati dell'ospite (nome, date, orario, ospiti, n° prenotazione,
   cosa chiede) e li mostra in "Dati trovati";
2. sceglie i **modelli** adatti (leggendo il loro "quando usarlo"), li compila
   con quei dati e usa la versione nella lingua dell'ospite, o traduce
   l'italiano;
3. usa le **informazioni hotel** (con le note per l'assistente);
4. scrive la risposta nella lingua dell'ospite, con la **traduzione italiana**
   sotto per lo staff, e segnala i dati mancanti e gli argomenti senza
   risposta.

La risposta si rifinisce con un clic ("Più breve", "Più formale", "Più
calorosa") o con un'istruzione libera; poi *Copia e segna come risposto* la
mette negli appunti, firmata, da incollare nel canale. Il messaggio resta in
Posta nello storico dell'ospite, con il canale indicato
(`smart_inbox_messages.source`; conversazione `<canale>:<nome>`). Chi incolla
diventa l'agent dell'ospite se non ne ha già uno.

Funziona anche **senza Outlook collegato**: per questa parte servono solo
`ANTHROPIC_API_KEY` e i secret di base (non quelli Microsoft).

## Booking.com, Expedia e Airbnb via email

I portali inoltrano i messaggi degli ospiti alla casella dell'hotel da un
indirizzo intermediario per prenotazione (es. `…@guest.booking.com`);
rispondendo a quell'indirizzo, la risposta arriva all'ospite sul portale.
Se quelle email arrivano nella casella collegata, Smart Inbox le riconosce
(`OTA_RELAY_DOMAINS` in `_shared/smart-inbox/filters.ts`), le mostra con il
canale del portale ("Booking.com · via email") e la risposta parte dalla
casella come per le altre email. Le notifiche automatiche dei portali
(`noreply@booking.com`…) restano escluse.

Il dominio di Booking.com è quello documentato; quelli di Expedia
(`m.expediapartnercentral.com`) e Airbnb (`reply.airbnb.com`) vanno
verificati sulle prime email reali di ogni struttura.

## Assegnazione

Ogni ospite ha al massimo un agent. In Posta:
- **Da assegnare**: gli ospiti che nessuno segue ancora, con **Prendi in
  carico** direttamente nella lista;
- nel dettaglio, un riquadro dice chi lo segue (nessuno / tu / un collega),
  con *Prendi in carico* o *Lascia*; *Assegna a* lo passa a un collega;
- chi risponde per primo a un ospite senza agent (o incolla il suo messaggio
  in Componi risposta) ne diventa l'agent; le email successive dello stesso
  ospite arrivano in "Assegnate a me".

## Il mio stile (per agent)

In Impostazioni ogni agent ha una sezione personale, che vede e modifica solo
lui (`smart_inbox_agent_preferences`):
- **tono** (o quello della struttura) e **indicazioni** brevi per
  l'assistente ("do sempre del lei"), usati nelle bozze che invia lui e in
  quelle degli ospiti che segue. Vanno nel messaggio, non nel prompt di
  sistema in cache, e non superano le regole della struttura;
- **lingue che legge**: sotto le bozze in quelle lingue non compare la
  traduzione italiana.

## Statistiche

Scheda **Statistiche** (`smart_inbox_stats()`): messaggi ricevuti, risposte
inviate, tempo di risposta (mediana e media), quota di bozze inviate senza
modifiche, ospiti da rispondere, andamento per giorno, per canale e per
agent. Ogni agent vede i totali e i propri numeri; i responsabili vedono
anche i colleghi.

## Firma dell'agent

Ogni risposta è firmata da chi la invia. In Impostazioni il responsabile
imposta un modello di firma con `{agent}` (nome dal profilo), `{ruolo}`
(qualifica in Team) e `{hotel}`; default `{agent}` / `{ruolo} — {hotel}`.
L'assistente scrive solo il testo e la formula di saluto nella lingua
dell'ospite ("Mit freundlichen Grüßen,"): la firma viene aggiunta dal server al
momento dell'invio (`signature.ts`), mai scritta dall'AI. Se permesso, sotto la
bozza si può scegliere di firmare a nome della struttura senza nome ("Front
Office — {hotel}"). La bozza speculare in Outlook porta la firma dell'agent
assegnato all'ospite; all'invio si usa sempre la firma di chi invia.

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

### Chiarezza e carico mentale

- **Due stati per lo staff**: "Da rispondere" (giallo) e "Risposto" (verde),
  più "Archiviata". Gli stati tecnici della pipeline restano sotto, come
  frase breve ("Bozza pronta", "Da scrivere a mano").
- **Contatori** in alto: ospiti da rispondere, urgenti, risposte inviate oggi.
- **Urgente / non urgente** (`smart_inbox_conversations.is_urgent`): l'AI lo
  imposta su un'email urgente, si azzera quando l'hotel risponde (se non ci
  sono altre email aperte), lo staff lo cambia con un clic. Gli urgenti sono
  in cima e c'è il filtro "Solo urgenti".
- **Mese del soggiorno** (`stay_month`): l'AI lo ricava dalle date nell'email
  (se nessuno l'ha già impostato), lo staff lo corregge; filtro per mese.
- **Note sull'ospite** (`notes`): visibili a tutti gli agent e passate
  all'AI, che le usa senza mai citarle.
- **Modelli di risposta** (`smart_inbox_templates`, gestiti da chi ha
  `smart_inbox.manage`): si inseriscono nella bozza con un clic, `{nome}`
  diventa il nome dell'ospite; l'AI li riceve nel blocco in cache come
  formulazioni approvate.
- Dopo l'invio l'interfaccia passa da sola all'ospite successivo.

### Permessi

| Capability | Ruoli | Cosa permette |
|---|---|---|
| `smart_inbox.view` | receptionist, manager, property_admin, organization_admin | essere agent: leggere la posta, prendere in carico/assegnare ospiti, modificare/inviare bozze, archiviare |
| `smart_inbox.manage` | manager, property_admin, organization_admin | collegare/scollegare Outlook, impostazioni, informazioni hotel, modelli di risposta, consumo AI |

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

### 1b. App Google (Gmail), facoltativa

Per collegare caselle Gmail / Google Workspace, una volta sola:

1. console.cloud.google.com → nuovo progetto (es. "homisuite-smart-inbox").
2. **API e servizi → Libreria** → abilitare **Gmail API**.
3. **Schermata consenso OAuth**: nome app, email di supporto, dominio
   dell'app; ambito `https://www.googleapis.com/auth/gmail.modify`.
4. **Credenziali → Crea credenziali → ID client OAuth** → *Applicazione web*,
   URI di reindirizzamento autorizzato:
   `https://<project-ref>.supabase.co/functions/v1/smart-inbox-oauth-callback`
   (lo stesso di Microsoft).
5. Secret: `SMART_INBOX_GOOGLE_CLIENT_ID` e `SMART_INBOX_GOOGLE_CLIENT_SECRET`.
6. Pianificare il controllo rapido (sezione 4).

Tipo di app, da sapere prima di partire:
- **Interna** (solo se il progetto Google Cloud è nella stessa
  organizzazione Google Workspace della casella): nessuna verifica, i
  collegamenti non scadono.
- **Esterna, in test** (Gmail personali o Workspace di altre organizzazioni):
  fino a 100 utenti di test indicati a mano, ma Google **fa scadere il
  collegamento dopo 7 giorni**: va ricollegato ogni settimana.
- **Esterna, in produzione**: `gmail.modify` è un ambito "riservato", Google
  richiede la verifica dell'app e una valutazione di sicurezza esterna
  (a pagamento, settimane) prima di toglierle il limite.

Gmail non avvisa da solo dei nuovi messaggi senza Google Pub/Sub: Smart
Inbox li legge con il controllo ogni 2 minuti (cronologia della casella,
nessun messaggio perso); la risposta parte da Gmail nella stessa
conversazione e la bozza compare anche nelle Bozze di Gmail.

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

Facoltativi: `SMART_INBOX_GOOGLE_CLIENT_ID` / `SMART_INBOX_GOOGLE_CLIENT_SECRET`
(Gmail, vedi 1b), `SMART_INBOX_MS_TENANT` (default `organizations`),
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

Con una casella **Gmail** collegata, aggiungere il controllo rapido ogni
2 minuti (`?task=poll` legge solo la posta nuova di Gmail e prepara le bozze):

```sql
select cron.schedule(
  'smart-inbox-gmail-poll',
  '*/2 * * * *',
  $$ select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/smart-inbox-maintenance?task=poll',
       headers := jsonb_build_object('x-smart-inbox-cron', '<SMART_INBOX_CRON_SECRET>')
     ) $$
);
```

Non è in una migration apposta: il secret non deve finire nel repository.

## Attivazione per una struttura

Decisione commerciale, come per Ristorazione e Turni: dalla console
Piattaforma (scheda della struttura → Moduli → Smart Inbox), oppure con il
service role:

```sql
insert into property_modules (property_id, module_id, enabled)
select '<property-id>', id, true from modules where slug = 'smart_inbox'
on conflict (property_id, module_id) do update set enabled = true;
```

Chi può usarlo: receptionist e manager rispondono agli ospiti per ruolo,
manager e admin gestiscono modelli, informazioni e impostazioni. In **Team →
Moduli** si può spegnere Smart Inbox per una singola persona (non compare più
neanche tra gli agent a cui assegnare un ospite) o dare "Risponde agli ospiti"
/ "Amministrazione" a chi non li ha per ruolo.

Poi, in homisuite → Smart Inbox:

1. **Impostazioni** → *Collega Outlook* (un manager), accedendo con l'account
   Microsoft 365 della casella da gestire.
2. **Informazioni hotel** → una voce per argomento (colazione, parcheggio,
   check-in…), con categoria e, se serve, una nota per l'assistente.
   L'assistente risponde solo con quello che è scritto qui; in cima compaiono
   le domande degli ospiti che non trovano risposta.
3. **Modelli** → risposte approvate per categoria, con "quando usarlo", campi
   (`{nome}`, `{data arrivo}`, `{ora arrivo}`, `{notti}`, `{ospiti}`,
   `{n° prenotazione}`, `{info: Titolo}`) e versioni in altre lingue.
4. **Impostazioni** → firma dell'agent, firma della struttura, tono,
   traduzione, canali da incollare, mittenti da ignorare.
5. In **Team**, la qualifica di ciascuno: è il `{ruolo}` della firma.

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
- WhatsApp, Booking.com e gli altri canali sono gestiti incollando i messaggi
  (Componi risposta): non c'è ancora un collegamento diretto.
