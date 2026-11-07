// One short, accurate guide per screen -- written from what each module's
// own code actually does (not generic placeholder text), shown through
// HelpButton either automatically the first time someone opens Homisuite,
// or on demand via the floating "?" present on every screen. Keyed by the
// same route-derived moduleKey ShellLayout/HelpButton compute, so adding a
// new screen's guide is just adding an entry here.
export interface HelpSection {
  heading: string
  body: string[]
}

export interface HelpTopic {
  title: string
  intro: string
  sections: HelpSection[]
}

export const GENERAL_HELP_KEY = 'generale'

export const helpContent: Record<string, HelpTopic> = {
  [GENERAL_HELP_KEY]: {
    title: 'Benvenuto in Homisuite',
    intro: 'Una rapida panoramica prima di iniziare -- la trovi di nuovo quando vuoi dal pulsante con il punto interrogativo, in basso a destra, in ogni schermata.',
    sections: [
      {
        heading: 'Come è organizzata l’app',
        body: [
          'La barra laterale a sinistra elenca i moduli attivi per la tua struttura -- vedi solo quelli a cui hai accesso.',
          '"Home" ti riporta sempre alla pagina principale con le card dei moduli.',
          'Se lavori in più strutture, il selettore in alto nella barra laterale cambia quella attiva.',
        ],
      },
      {
        heading: 'Serve aiuto in una sezione specifica?',
        body: [
          'Il pulsante "?" in basso a destra mostra sempre la guida della schermata in cui ti trovi -- non devi tornare qui.',
        ],
      },
    ],
  },
  home: {
    title: 'Home',
    intro: 'Il punto di partenza: da qui apri rapidamente i moduli abilitati per questa struttura.',
    sections: [
      {
        heading: 'Le card dei moduli',
        body: [
          'Vedi solo i moduli attivati per la struttura E a cui il tuo account ha davvero accesso -- se un modulo non appare, chiedi a un amministratore di verificarlo da Team.',
          'Tocca una card intera per aprire il modulo, non solo il testo "Apri modulo".',
        ],
      },
      {
        heading: 'Avvisi',
        body: ['La riga in basso segnala eventuali criticità urgenti che richiedono attenzione.'],
      },
    ],
  },
  housekeeping: {
    title: 'Housekeeping',
    intro: 'Richieste degli ospiti e operatività delle camere.',
    sections: [
      {
        heading: 'La coda delle richieste',
        body: [
          'Le richieste in sospeso sono raggruppate per urgenza, non in un unico elenco -- quelle che servono un’azione subito vengono per prime.',
          'Prendi in carico una richiesta per assegnartela; aggiornane lo stato man mano che procedi.',
        ],
      },
      {
        heading: 'Se vedi solo questa schermata, senza menu laterale',
        body: ['È normale: il tuo ruolo è impostato per operare solo su Housekeeping, senza accesso agli altri moduli.'],
      },
      {
        heading: 'Gestione',
        body: ['Categorie, articoli e impostazioni del reparto sono visibili solo a chi ha i permessi di gestione per questo modulo.'],
      },
    ],
  },
  dining: {
    title: 'Ristorazione',
    intro: 'Ristoranti convenzionati e prenotazioni degli ospiti.',
    sections: [
      {
        heading: 'Prenotazioni · Oggi',
        body: [
          'In alto trovi il riepilogo della giornata e la coda "Da gestire", raggruppata per il tipo di azione che serve (contattare il ristorante, proporre un’alternativa, prendere in carico una richiesta nuova).',
          'Sotto, il programma completo di oggi, filtrabile per stato.',
        ],
      },
      {
        heading: 'Prenotazioni · Tutte',
        body: [
          'L’archivio completo, con ricerca libera e filtri per ristorante, stato e intervallo di date.',
          'Apri una riga per vedere il dettaglio: puoi modificare i dati della prenotazione, cambiarne lo stato, aggiungere ristoranti alternativi o una nota.',
        ],
      },
      {
        heading: 'Aggiungi prenotazione',
        body: ['Per una prenotazione presa per telefono o di persona -- si trova in alto a destra nella scheda Prenotazioni.'],
      },
      {
        heading: 'Ristoranti, Categorie, Registro modifiche',
        body: ['Gestiscono l’elenco dei ristoranti e delle categorie, e tengono traccia di ogni modifica fatta sulle prenotazioni -- riservati a chi ha i permessi di gestione.'],
      },
    ],
  },
  turni: {
    title: 'Turni',
    intro: 'Pianificazione dei turni e copertura del personale.',
    sections: [
      {
        heading: 'Il calendario',
        body: [
          'Mostra l’organico assegnato mese per mese, reparto per reparto.',
          'Chi gestisce i turni può generare automaticamente le assegnazioni o modificarle a mano; il personale operativo vede qui il proprio turno.',
        ],
      },
      {
        heading: 'Richieste',
        body: ['Cambi turno, ferie e assenze passano dalla casella di richieste -- chi le gestisce le approva o le rifiuta da lì.'],
      },
    ],
  },
  team: {
    title: 'Team',
    intro: 'Chi ha accesso a questa struttura, con quale ruolo.',
    sections: [
      {
        heading: 'L’elenco',
        body: ['Ogni riga mostra ruolo, mansione e stato dell’accesso di una persona.'],
      },
      {
        heading: 'Azioni su una persona',
        body: [
          'Modifica ruolo o mansione, reimposta la password, attiva/disattiva l’accesso, oppure rimuovi la persona dalla struttura.',
          'I permessi aggiuntivi oltre a quelli del ruolo base (ad esempio dare a un receptionist anche la gestione di un modulo) si assegnano persona per persona.',
        ],
      },
      {
        heading: 'Nuovo utente',
        body: ['Crea un account con username e password per chi non ha (o non vuole usare) un indirizzo email.'],
      },
    ],
  },
  impostazioni: {
    title: 'Impostazioni',
    intro: 'Il tuo profilo e le preferenze dell’app.',
    sections: [
      {
        heading: 'Il tuo account',
        body: ['Profilo, sicurezza dell’accesso, lingua e tema (chiaro/scuro) si gestiscono da qui.'],
      },
      {
        heading: 'Struttura',
        body: ['Chi ha i permessi di amministrazione trova anche i dati della struttura, come logo e fuso orario.'],
      },
    ],
  },
  moduli: {
    title: 'Moduli',
    intro: 'I moduli disponibili su Homisuite e quelli attivi per questa struttura.',
    sections: [
      {
        heading: 'Attivare o disattivare un modulo',
        body: ['È una decisione a livello di struttura, separata dai permessi dei singoli membri del team -- un modulo attivo qui va comunque abilitato persona per persona da Team, se serve limitarne l’accesso.'],
      },
    ],
  },
  transfer: {
    title: 'Transfer',
    intro: 'Gestione di transfer e spostamenti degli ospiti.',
    sections: [
      { heading: 'In arrivo', body: ['Questo modulo non è ancora disponibile.'] },
    ],
  },
}

export function helpTopicFor(moduleKey: string): HelpTopic {
  return helpContent[moduleKey] ?? helpContent[GENERAL_HELP_KEY]!
}
