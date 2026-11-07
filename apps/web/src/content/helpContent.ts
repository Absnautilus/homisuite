import {
  Bell, Boxes, Building2, CalendarCheck, CalendarDays, Clock, Compass, Hotel, Inbox,
  LayoutGrid, ListChecks, Plus, Search, Settings2, UserCog, UserPlus, UserRound, Users,
  UtensilsCrossed, type LucideIcon,
} from 'lucide-react'

// One short, accurate guide per screen -- written from what each module's
// own code actually does (not generic placeholder text), shown through
// HelpButton either automatically the first time someone opens Homisuite,
// or on demand via the floating "?" present on every screen. Keyed by the
// same route-derived moduleKey ShellLayout/HelpButton compute, so adding a
// new screen's guide is just adding an entry here.
//
// `version` is what keeps a returning staff member from missing a change:
// bump it whenever a topic's content actually changes (a new workflow, a
// renamed button, a whole new section) -- HelpButton compares it against
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
          'Il pulsante "?" in basso a destra mostra sempre la guida della schermata in cui ti trovi -- non devi tornare qui.',
          'Un puntino acceso sul pulsante significa che quella guida è stata aggiornata da quando l’hai vista l’ultima volta.',
        ],
      },
    ],
  },
  home: {
    title: 'Home',
    intro: 'Il punto di partenza: da qui apri rapidamente i moduli abilitati per questa struttura.',
    version: 1,
    sections: [
      {
        heading: 'Le card dei moduli',
        icon: LayoutGrid,
        body: [
          'Vedi solo i moduli attivati per la struttura E a cui il tuo account ha davvero accesso -- se un modulo non appare, chiedi a un amministratore di verificarlo da Team.',
          'Tocca una card intera per aprire il modulo, non solo il testo "Apri modulo".',
        ],
      },
      {
        heading: 'Avvisi',
        icon: Bell,
        body: ['La riga in basso segnala eventuali criticità urgenti che richiedono attenzione.'],
      },
    ],
  },
  housekeeping: {
    title: 'Housekeeping',
    intro: 'Richieste degli ospiti e operatività delle camere.',
    version: 1,
    sections: [
      {
        heading: 'La coda delle richieste',
        icon: ListChecks,
        body: [
          'Le richieste in sospeso sono raggruppate per urgenza, non in un unico elenco -- quelle che servono un’azione subito vengono per prime.',
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
    version: 2,
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
          'L’archivio completo, con ricerca libera e filtri per ristorante, stato e -- da oggi -- intervallo di date, così non scorri più l’intera cronologia.',
          'Apri una riga per vedere il dettaglio: ora puoi anche modificare i dati della prenotazione (ospite, camera, data, ora, persone), non solo lo stato.',
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
    version: 1,
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
    version: 1,
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
    version: 1,
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
    version: 1,
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
}

export function helpTopicFor(moduleKey: string): HelpTopic {
  return helpContent[moduleKey] ?? helpContent[GENERAL_HELP_KEY]!
}
