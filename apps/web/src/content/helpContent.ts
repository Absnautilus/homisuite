import {
  Boxes, Building2, CalendarCheck, CalendarDays, Clock, Compass, Hotel, Inbox,
  LayoutGrid, ListChecks, Plus, Search, Settings2, UserCog, UserPlus, UserRound, Users,
  FileText, Mail, Sparkles, UtensilsCrossed, type LucideIcon,
} from 'lucide-react'
import type { TourStep } from '../components/TourOverlay'

// One short, accurate guide per screen -- written from what each module's
// own code actually does (not generic placeholder text), shown through
// HelpButton either automatically the first time someone opens Homisuite,
// or on demand via the floating "?" present on every screen. Keyed by the
// same route-derived moduleKey ShellLayout/HelpButton compute, so adding a
// new screen's guide is just adding an entry here.
//
// `version` is what keeps a returning staff member from missing a change:
// bump it whenever a topic's content -- OR the matching entry in
// moduleTours below -- actually changes (a new workflow, a renamed
// button, a step added to the tour) -- HelpButton compares it against
// what this browser last saw and badges the floating button until they
// open it again. The guide's text still only updates when someone (today,
// a Claude session) edits this file alongside the real feature -- nothing
// generates this content on its own -- but the badge closes the other
// half of the gap: staff are told something changed instead of relying on
// noticing by themselves.
export interface HelpSection {
  heading: string
  icon: LucideIcon
  body: string[]
}

export interface HelpTopic {
  title: string
  intro: string
  version: number
  sections: HelpSection[]
}

export const GENERAL_HELP_KEY = 'generale'

export const helpContent: Record<string, HelpTopic> = {
  [GENERAL_HELP_KEY]: {
    title: 'Benvenuto in Homisuite',
    intro: 'Una rapida panoramica prima di iniziare -- la trovi di nuovo quando vuoi dal pulsante con il punto interrogativo, in basso a destra, in ogni schermata.',
    version: 1,
    sections: [
      {
        heading: 'Come è organizzata l’app',
        icon: Compass,
        body: [
          'La barra laterale a sinistra elenca i moduli attivi per la tua struttura -- vedi solo quelli a cui hai accesso.',
          '"Home" ti riporta sempre alla pagina principale con le card dei moduli.',
          'Se lavori in più strutture, il selettore in alto nella barra laterale cambia quella attiva.',
        ],
      },
      {
        heading: 'Serve aiuto in una sezione specifica?',
        icon: LayoutGrid,
        body: [
          'Il pulsante "?" in basso a destra apre sempre la guida della schermata in cui ti trovi -- non devi tornare qui.',
          'Da quella guida, quando la sezione ne ha uno, puoi anche far ripartire il tour interattivo che evidenzia gli elementi reali della pagina.',
          'Un puntino acceso sul pulsante significa che quella guida è stata aggiornata da quando l’hai vista l’ultima volta.',
        ],
      },
    ],
  },
  housekeeping: {
    title: 'Housekeeping',
    intro: 'Richieste degli ospiti e operatività delle camere.',
    version: 3,
    sections: [
      {
        heading: 'La coda delle richieste',
        icon: ListChecks,
        body: [
          'Nuove, in corso e completate vivono su schede separate (Nuove / In corso / Completate), non in un unico elenco.',
          'Prendi in carico una richiesta per assegnartela; aggiornane lo stato man mano che procedi.',
        ],
      },
      {
        heading: 'Se vedi solo questa schermata, senza menu laterale',
        icon: Hotel,
        body: ['È normale: il tuo ruolo è impostato per operare solo su Housekeeping, senza accesso agli altri moduli.'],
      },
      {
        heading: 'Gestione',
        icon: Settings2,
        body: ['Categorie, articoli e impostazioni del reparto sono visibili solo a chi ha i permessi di gestione per questo modulo.'],
      },
    ],
  },
  dining: {
    title: 'Ristorazione',
    intro: 'Ristoranti convenzionati e prenotazioni degli ospiti.',
    version: 4,
    sections: [
      {
        heading: 'Prenotazioni · Oggi',
        icon: CalendarCheck,
        body: [
          'In alto trovi il riepilogo della giornata e la coda "Da gestire", raggruppata per il tipo di azione che serve (contattare il ristorante, proporre un’alternativa, prendere in carico una richiesta nuova).',
          'Sotto, il programma completo di oggi, filtrabile per stato.',
        ],
      },
      {
        heading: 'Prenotazioni · Tutte',
        icon: Search,
        body: [
          'L’archivio completo, con ricerca libera e filtri per ristorante, stato e intervallo di date, così non scorri più l’intera cronologia.',
          'Apri una riga per vedere il dettaglio: puoi anche modificare i dati della prenotazione (ospite, camera, data, ora, persone), non solo lo stato.',
        ],
      },
      {
        heading: 'Aggiungi prenotazione',
        icon: Plus,
        body: [
          'Per una prenotazione presa per telefono o di persona -- si trova in alto a destra nella scheda Prenotazioni.',
          'Puoi segnare anche le preferenze dell’ospite (es. vista mare, seggiolone), le stesse che compaiono per le prenotazioni fatte dall’ospite.',
        ],
      },
      {
        heading: 'Ristoranti, Categorie, Registro modifiche',
        icon: UtensilsCrossed,
        body: ['Gestiscono l’elenco dei ristoranti e delle categorie, e tengono traccia di ogni modifica fatta sulle prenotazioni -- riservati a chi ha i permessi di gestione.'],
      },
    ],
  },
  turni: {
    title: 'Turni',
    intro: 'Pianificazione dei turni e copertura del personale.',
    version: 3,
    sections: [
      {
        heading: 'Il calendario',
        icon: CalendarDays,
        body: [
          'Mostra l’organico assegnato mese per mese, reparto per reparto.',
          'Chi gestisce i turni può generare automaticamente le assegnazioni o modificarle a mano; il personale operativo vede qui il proprio turno.',
        ],
      },
      {
        heading: 'Richieste',
        icon: Inbox,
        body: ['Cambi turno, ferie e assenze passano dalla casella di richieste -- chi le gestisce le approva o le rifiuta da lì.'],
      },
    ],
  },
  team: {
    title: 'Team',
    intro: 'Chi ha accesso a questa struttura, con quale ruolo.',
    version: 2,
    sections: [
      {
        heading: 'L’elenco',
        icon: Users,
        body: ['Ogni riga mostra ruolo, mansione e stato dell’accesso di una persona.'],
      },
      {
        heading: 'Azioni su una persona',
        icon: UserCog,
        body: [
          'Modifica ruolo o mansione, reimposta la password, attiva/disattiva l’accesso, oppure rimuovi la persona dalla struttura.',
          'I permessi aggiuntivi oltre a quelli del ruolo base (ad esempio dare a un receptionist anche la gestione di un modulo) si assegnano persona per persona.',
        ],
      },
      {
        heading: 'Nuovo utente',
        icon: UserPlus,
        body: ['Crea un account con username e password per chi non ha (o non vuole usare) un indirizzo email.'],
      },
    ],
  },
  impostazioni: {
    title: 'Impostazioni',
    intro: 'Il tuo profilo e le preferenze dell’app.',
    version: 2,
    sections: [
      {
        heading: 'Il tuo account',
        icon: UserRound,
        body: ['Profilo, sicurezza dell’accesso, lingua e tema (chiaro/scuro) si gestiscono da qui.'],
      },
      {
        heading: 'Struttura',
        icon: Building2,
        body: ['Chi ha i permessi di amministrazione trova anche i dati della struttura, come logo e fuso orario.'],
      },
    ],
  },
  moduli: {
    title: 'Moduli',
    intro: 'I moduli disponibili su Homisuite e quelli attivi per questa struttura.',
    version: 2,
    sections: [
      {
        heading: 'Attivare o disattivare un modulo',
        icon: Boxes,
        body: ['È una decisione a livello di struttura, separata dai permessi dei singoli membri del team -- un modulo attivo qui va comunque abilitato persona per persona da Team, se serve limitarne l’accesso.'],
      },
    ],
  },
  transfer: {
    title: 'Transfer',
    intro: 'Gestione di transfer e spostamenti degli ospiti.',
    version: 1,
    sections: [
      { heading: 'In arrivo', icon: Clock, body: ['Questo modulo non è ancora disponibile.'] },
    ],
  },
  'smart-inbox': {
    title: 'Smart Inbox',
    intro: 'Le email degli ospiti arrivate su Outlook, con una bozza di risposta già pronta.',
    version: 3,
    sections: [
      {
        heading: 'Posta',
        icon: Inbox,
        body: [
          'In alto vedi subito quanti ospiti aspettano una risposta, quanti sono urgenti e quante risposte sono partite oggi.',
          'Ogni ospite è una conversazione con due soli stati: "Da rispondere" (giallo) o "Risposto" (verde). Gli urgenti hanno il bordo rosso e stanno in cima; poi chi aspetta da più tempo.',
          'Filtra per "Solo urgenti" o per mese del soggiorno. Il mese lo propone l’assistente leggendo l’email; puoi cambiarlo, come anche "Urgente / Non urgente", con un clic.',
          'Nelle "Note sull’ospite" scrivi quello che i colleghi devono sapere (VIP, allergie, ricorrenze): le legge anche l’assistente.',
          'Dopo "Invia risposta" si passa da soli all’ospite successivo da rispondere.',
          'Ogni conversazione ha un agent, il collega che la segue. Usa "Prendi in carico" o scegli un collega dal menu Agent; in "Assegnate a me" trovi solo i tuoi ospiti. Chi risponde per primo a un ospite non assegnato ne diventa l’agent.',
          'Correggi la bozza se serve, poi premi "Invia risposta": parte dalla casella Outlook dell’hotel. Niente viene inviato senza la tua conferma.',
          'Se sotto lo stato leggi "Bozza da controllare con attenzione" o "Da scrivere a mano" (reclami, rimborsi, domande senza risposta nelle informazioni), rileggi bene prima di inviare.',
        ],
      },
      {
        heading: 'Informazioni hotel',
        icon: Sparkles,
        body: [
          'L’assistente risponde solo con quello che è scritto in questa sezione. Se un’informazione manca, scrive che il team risponderà a breve.',
          'Aggiungi una sezione per argomento (colazione, parcheggio, check-in...). Più è completa, meno email restano da gestire a mano.',
        ],
      },
      {
        heading: 'Modelli di risposta',
        icon: FileText,
        body: [
          'Risposte pronte (istruzioni check-in, come arrivare, cancellazioni…) da inserire con "Inserisci modello" mentre scrivi. {nome} diventa il nome dell’ospite.',
          'L’assistente usa i modelli anche come esempio quando prepara le bozze.',
        ],
      },
      {
        heading: 'Impostazioni',
        icon: Mail,
        body: [
          'Un responsabile collega qui la casella Outlook (es. info@) accedendo con l’account Microsoft 365 della casella.',
          'Firma, tono e mittenti da ignorare valgono per tutte le bozze della struttura.',
        ],
      },
    ],
  },
}

export function helpTopicFor(moduleKey: string): HelpTopic {
  return helpContent[moduleKey] ?? helpContent[GENERAL_HELP_KEY]!
}

// The real, interactive tour (TourOverlay) -- spotlights actual elements on
// the real page in sequence, rather than describing them in a modal. Each
// target is a data-tour attribute added at the source of the real page
// (ShellLayout, HomePage, the module itself, HelpButton), never a guessed
// selector. Steps whose target isn't on the current page are skipped
// automatically (see TourOverlay), so a module's list stays safe to launch
// from wherever its own floating "?" is, and a permission gate hiding part
// of a screen (a facchino's stripped Housekeeping queue, an employee's
// read-only Turni) just shortens the tour rather than breaking it.
//
// Never launched directly from the floating "?" -- clicking it always
// opens the module's own HelpTopic modal first (see HelpButton.tsx); a
// "Rivedi il tour" action inside that modal starts the tour below for
// whichever module has one. The one exception is the very first time this
// browser ever opens Homisuite, where the Home tour runs once on its own
// as the welcome. A module's own HelpTopic.version is still what drives
// its badge -- bump that (not anything here) when a tour's steps change.
export interface ModuleTour {
  steps: TourStep[]
}

export const moduleTours: Record<string, ModuleTour> = {
  home: {
    steps: [
      {
        target: '[data-tour="brand"]',
        title: 'Benvenuto in Homisuite',
        body: 'Un tour rapido prima di iniziare. Lo ritrovi sempre dalla guida che apre il pulsante "?" in basso a destra.',
      },
      {
        target: '[data-tour="property-switcher"]',
        title: 'La tua struttura',
        body: 'Se lavori in più strutture, da qui cambi quella attiva in qualsiasi momento -- ogni modulo, ogni richiesta e ogni membro del team che vedi dipende da quale struttura hai selezionato qui.',
      },
      {
        target: '[data-tour="nav"]',
        title: 'I moduli',
        body: 'La barra laterale elenca i moduli attivi per questa struttura -- vedi solo quelli a cui hai davvero accesso. Team, Impostazioni e Moduli sono sempre in fondo, separati dai moduli operativi.',
      },
      {
        target: '[data-tour="module-grid"]',
        title: 'Apri un modulo',
        body: 'Da qui apri rapidamente qualsiasi modulo abilitato -- tocca la card intera, non solo il testo. Ogni modulo ha poi la sua guida e il suo tour, richiamabili dal "?" al suo interno.',
      },
      {
        target: '[data-tour="account"]',
        title: 'Il tuo account',
        body: 'Profilo e uscita dall’app sono sempre qui, in basso.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Questo pulsante apre sempre la guida della schermata in cui ti trovi; da lì, quando c’è un tour per quella sezione, puoi farlo ripartire quando vuoi.',
      },
    ],
  },
  dining: {
    steps: [
      {
        target: '[data-tour="dining-nav"]',
        title: 'Le sezioni di Ristorazione',
        body: 'Cinque schede in alto -- Prenotazioni, Ristoranti, Categorie, Registro modifiche e Impostazioni. Le vediamo una per una, poi entriamo nel dettaglio di Prenotazioni.',
      },
      {
        target: '[role="tab"][data-value="ristoranti"]',
        title: 'Ristoranti',
        body: 'L’elenco dei ristoranti convenzionati: orari di apertura, se sono consigliati o visibili agli ospiti, e le loro impostazioni -- visibile solo a chi ha i permessi di gestione.',
      },
      {
        target: '[role="tab"][data-value="categorie"]',
        title: 'Categorie',
        body: 'Le categorie usate per organizzare i ristoranti (es. colazione, cena, bar) -- anche questa riservata a chi gestisce il modulo.',
      },
      {
        target: '[role="tab"][data-value="registro"]',
        title: 'Registro modifiche',
        body: 'La cronologia di ogni modifica fatta sulle prenotazioni -- chi, cosa e quando, utile in caso di dubbi su una richiesta.',
      },
      {
        target: '[role="tab"][data-value="impostazioni"]',
        title: 'Impostazioni',
        body: 'Da qui gestisci le preferenze ospite selezionabili (vista mare, seggiolone…) e quali ristoranti sono visibili nell’app ospite.',
      },
      {
        target: '[data-tour="dining-queue"]',
        title: 'Da gestire',
        body: 'Le richieste che hanno bisogno di un’azione, raggruppate per cosa serve fare: "Non disponibile" vuole un’alternativa, "In attesa di conferma" va seguita, "Nuove richieste" va presa in carico. L’ordine dei gruppi segue l’urgenza.',
        activate: ['[role="tab"][data-value="prenotazioni"]', '[role="tab"][data-value="oggi"]'],
      },
      {
        target: '[data-tour="dining-add"]',
        title: 'Aggiungi prenotazione',
        body: 'Per una prenotazione presa per telefono o di persona. Puoi segnare anche le preferenze dell’ospite (vista mare, seggiolone…), le stesse che vede chi gestisce la richiesta.',
        activate: ['[role="tab"][data-value="prenotazioni"]'],
      },
      {
        target: '[data-tour="dining-today"]',
        title: 'Programma di oggi',
        body: 'L’elenco completo delle prenotazioni di oggi, filtrabile per stato. Apri una riga per vedere il dettaglio e modificarne i dati.',
        activate: ['[role="tab"][data-value="prenotazioni"]', '[role="tab"][data-value="oggi"]'],
      },
      {
        target: '[data-tour="dining-filters"]',
        title: 'Cercare nell’archivio',
        body: 'Nella scheda "Tutte" puoi cercare per ospite, camera o ristorante, e restringere per stato o per intervallo di date -- utile per ritrovare una prenotazione passata senza scorrere tutto lo storico.',
        activate: ['[role="tab"][data-value="prenotazioni"]', '[role="tab"][data-value="tutte"]'],
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui apri la guida di questa sezione, con un pulsante per rivedere questo tour quando vuoi.',
      },
    ],
  },
  housekeeping: {
    steps: [
      {
        target: '[data-tour="hk-nav"]',
        title: 'Richieste, Soggiorni, Gestione',
        body: 'Le sezioni di Housekeeping -- vedi solo quelle a cui hai accesso. Chi gestisce la reception vede anche i conteggi delle richieste da fare direttamente qui.',
        activate: ['[role="tab"][data-value="/housekeeping"]'],
      },
      {
        target: '[role="tab"][data-value="/housekeeping/soggiorni"]',
        title: 'Soggiorni',
        body: 'La lista delle camere occupate, con check-in e check-out: da qui registri un soggiorno, lo modifichi o lo chiudi -- visibile a chi gestisce la reception.',
        activate: ['[role="tab"][data-value="/housekeeping"]'],
      },
      {
        target: '[role="tab"][data-value="/housekeeping/admin"]',
        title: 'Gestione',
        body: 'Personale, camere, menu delle richieste (categorie e articoli), statistiche e integrazioni -- riservata a chi ha i permessi di amministrazione.',
        activate: ['[role="tab"][data-value="/housekeeping"]'],
      },
      {
        target: '[data-tour="hk-tabs"]',
        title: 'Nuove, In corso, Completate',
        body: 'La coda è divisa in tre schede: le richieste nuove da prendere in carico, quelle già assegnate e in lavorazione, e lo storico di quelle completate o annullate.',
        activate: ['[role="tab"][data-value="/housekeeping"]'],
      },
      {
        target: '[data-tour="hk-queue"]',
        title: 'Una richiesta',
        body: 'Ogni scheda mostra camera, oggetto richiesto e tempo trascorso. Prendi in carico una richiesta per assegnartela, poi aggiornane lo stato quando la completi.',
        activate: ['[role="tab"][data-value="/housekeeping"]'],
      },
      {
        target: '[data-tour="hk-new-request"]',
        title: 'Nuova richiesta',
        body: 'Per registrare una richiesta arrivata per telefono o di persona, invece che dall’app ospite.',
        activate: ['[role="tab"][data-value="/housekeeping"]'],
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui apri la guida di questa sezione, con un pulsante per rivedere questo tour quando vuoi.',
      },
    ],
  },
  turni: {
    steps: [
      {
        target: '[data-tour="shifts-nav"]',
        title: 'Operativo e Impostazioni',
        body: 'Il calendario, i tuoi turni e le tue richieste da un lato; la configurazione del modulo dall’altro -- quest’ultima visibile solo a chi gestisce i turni.',
      },
      {
        target: '[role="tab"][data-value="impostazioni"]',
        title: 'Impostazioni del modulo',
        body: 'Dipendenti, Unità, Regole turni e Codici turno -- la configurazione vera e propria: chi fa parte di ogni unità, come generare i turni automaticamente e quali codici (es. "M" mattina, "R" riposo) usare.',
      },
      {
        target: '[data-tour="shifts-grid"]',
        title: 'Il calendario',
        body: 'L’organico assegnato giorno per giorno, un codice turno per cella. Chi gestisce i turni può modificarlo direttamente cliccando su una cella; i turni bloccati restano fissi anche dopo una nuova assegnazione automatica.',
        activate: ['[role="tab"][data-value="operativo"]', '[role="tab"][data-value="calendar"]'],
      },
      {
        target: '[data-tour="shifts-actions"]',
        title: 'Assegna e salva',
        body: 'Genera automaticamente i turni del mese rispettando le regole di copertura, oppure modificali a mano. Lo stato Bozza/Definitivo riguarda un mese alla volta; salva per rendere permanenti le modifiche.',
        activate: ['[role="tab"][data-value="operativo"]', '[role="tab"][data-value="calendar"]'],
      },
      {
        target: '[data-tour="shifts-requests"]',
        title: 'Richieste in sospeso',
        body: 'Cambi turno, ferie e permessi arrivano qui prima di essere approvati o rifiutati da chi gestisce il reparto.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui apri la guida di questa sezione, con un pulsante per rivedere questo tour quando vuoi.',
      },
    ],
  },
  team: {
    steps: [
      {
        target: '[data-tour="team-add"]',
        title: 'Crea profilo',
        body: 'Aggiungi una persona al team, con invito email o con credenziali dirette (username e password) per chi non usa un indirizzo email.',
      },
      {
        target: '[data-tour="team-table"]',
        title: 'Il team',
        body: 'Ruolo, mansione e stato dell’accesso di ogni persona, raggruppati per mansione. Da ogni riga puoi modificare, reimpostare la password, gestire i moduli a cui ha accesso o rimuovere la persona.',
      },
      {
        target: '[data-tour="team-jobs"]',
        title: 'Mansioni della struttura',
        body: 'Descrivono il lavoro reale in hotel (es. Reception, Governante) e sono separate dal ruolo Homisuite, che decide invece cosa quella persona può fare nel software.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui apri la guida di questa sezione, con un pulsante per rivedere questo tour quando vuoi.',
      },
    ],
  },
  impostazioni: {
    steps: [
      {
        target: '[data-tour="settings-account"]',
        title: 'Il tuo account',
        body: 'Profilo, lingua, tema chiaro/scuro e notifiche push si gestiscono da qui -- valgono per te, in ogni struttura in cui lavori.',
      },
      {
        target: '[data-tour="settings-property"]',
        title: 'Struttura',
        body: 'Dati condivisi da tutti i moduli: logo, fuso orario, orari di check-in/out e contatti pubblici -- visibile solo a chi amministra la struttura.',
      },
      {
        target: '[data-tour="settings-modules"]',
        title: 'Impostazioni moduli',
        body: 'Configurazioni specifiche di ogni modulo attivo (ad esempio categorie e articoli di Housekeeping), separate dalle preferenze personali qui sopra.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui apri la guida di questa sezione, con un pulsante per rivedere questo tour quando vuoi.',
      },
    ],
  },
  moduli: {
    steps: [
      {
        target: '[data-tour="modules-list"]',
        title: 'I moduli di questa struttura',
        body: 'Attivo o non attivo, a livello di struttura -- indipendente dai permessi dei singoli membri del team: un modulo attivo qui va comunque abilitato persona per persona da Team, se serve limitarne l’accesso.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui apri la guida di questa sezione, con un pulsante per rivedere questo tour quando vuoi.',
      },
    ],
  },
}
