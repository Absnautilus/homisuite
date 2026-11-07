import { Clock, Compass, LayoutGrid, type LucideIcon } from 'lucide-react'
import type { TourStep } from '../components/TourOverlay'

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
  // Every module with real, interactive UI (housekeeping, dining, turni,
  // team, impostazioni, moduli) has no modal entry here -- its floating
  // button launches a real spotlight tour (TourOverlay, via moduleTours
  // below) over its actual elements instead of describing them in a
  // modal. See HelpButton.tsx. Only screens with nothing concrete to
  // point at yet (transfer) stay on this modal, alongside the generic
  // welcome topic above.
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
// `version` works exactly like HelpTopic's own: bump it whenever a
// module's real steps actually change (a renamed element, a moved button,
// a whole new step) so HelpButton's badge tells a returning member
// something changed here.
export interface ModuleTour {
  version: number
  steps: TourStep[]
}

export const moduleTours: Record<string, ModuleTour> = {
  home: {
    version: 1,
    steps: [
      {
        target: '[data-tour="brand"]',
        title: 'Benvenuto in Homisuite',
        body: 'Un tour rapido di quattro passi prima di iniziare. Lo ritrovi sempre dal pulsante "?" in basso a destra.',
      },
      {
        target: '[data-tour="property-switcher"]',
        title: 'La tua struttura',
        body: 'Se lavori in più strutture, da qui cambi quella attiva in qualsiasi momento.',
      },
      {
        target: '[data-tour="nav"]',
        title: 'I moduli',
        body: 'La barra laterale elenca i moduli attivi per questa struttura -- vedi solo quelli a cui hai davvero accesso.',
      },
      {
        target: '[data-tour="module-grid"]',
        title: 'Apri un modulo',
        body: 'Da qui apri rapidamente qualsiasi modulo abilitato -- tocca la card intera, non solo il testo.',
      },
      {
        target: '[data-tour="account"]',
        title: 'Il tuo account',
        body: 'Profilo e uscita dall’app sono sempre qui, in basso.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Questo pulsante mostra sempre la guida della schermata in cui ti trovi, e da qui puoi far ripartire questo tour quando vuoi.',
      },
    ],
  },
  dining: {
    version: 1,
    steps: [
      {
        target: '[data-tour="dining-nav"]',
        title: 'Le sezioni di Ristorazione',
        body: 'Prenotazioni, Ristoranti, Categorie e Registro modifiche -- le ultime tre visibili solo a chi ha i permessi di gestione.',
      },
      {
        target: '[data-tour="dining-queue"]',
        title: 'Da gestire',
        body: 'Le richieste che hanno bisogno di un’azione, raggruppate per cosa serve fare: contattare il ristorante, proporre un’alternativa o prendere in carico una richiesta nuova.',
      },
      {
        target: '[data-tour="dining-add"]',
        title: 'Aggiungi prenotazione',
        body: 'Per una prenotazione presa per telefono o di persona.',
      },
      {
        target: '[data-tour="dining-today"]',
        title: 'Programma di oggi',
        body: 'L’elenco completo delle prenotazioni di oggi, filtrabile per stato.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui puoi far ripartire questo tour quando vuoi.',
      },
    ],
  },
  housekeeping: {
    version: 1,
    steps: [
      {
        target: '[data-tour="hk-nav"]',
        title: 'Richieste, Soggiorni, Gestione',
        body: 'Le sezioni di Housekeeping -- vedi solo quelle a cui hai accesso.',
      },
      {
        target: '[data-tour="hk-queue"]',
        title: 'La coda delle richieste',
        body: 'Nuove, in corso e completate, su schede separate. Prendi in carico una richiesta per assegnartela.',
      },
      {
        target: '[data-tour="hk-new-request"]',
        title: 'Nuova richiesta',
        body: 'Per registrare una richiesta arrivata per telefono o di persona.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui puoi far ripartire questo tour quando vuoi.',
      },
    ],
  },
  turni: {
    version: 1,
    steps: [
      {
        target: '[data-tour="shifts-nav"]',
        title: 'Operativo e Impostazioni',
        body: 'Il calendario e i tuoi turni da un lato, la configurazione del modulo dall’altro -- quest’ultima visibile solo a chi gestisce i turni.',
      },
      {
        target: '[data-tour="shifts-grid"]',
        title: 'Il calendario',
        body: 'L’organico assegnato giorno per giorno. Chi gestisce i turni può modificarlo direttamente da qui.',
      },
      {
        target: '[data-tour="shifts-actions"]',
        title: 'Assegna e salva',
        body: 'Genera automaticamente i turni del mese o modificali a mano, poi salva per rendere definitive le modifiche.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui puoi far ripartire questo tour quando vuoi.',
      },
    ],
  },
  team: {
    version: 1,
    steps: [
      {
        target: '[data-tour="team-add"]',
        title: 'Crea profilo',
        body: 'Aggiungi una persona al team, con invito email o con credenziali dirette.',
      },
      {
        target: '[data-tour="team-table"]',
        title: 'Il team',
        body: 'Ruolo, mansione e stato dell’accesso di ogni persona, raggruppati per mansione.',
      },
      {
        target: '[data-tour="team-jobs"]',
        title: 'Mansioni della struttura',
        body: 'Descrivono il lavoro reale in hotel, separate dal ruolo Homisuite che decide cosa si può fare nel software.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui puoi far ripartire questo tour quando vuoi.',
      },
    ],
  },
  impostazioni: {
    version: 1,
    steps: [
      {
        target: '[data-tour="settings-account"]',
        title: 'Il tuo account',
        body: 'Profilo, lingua, tema e notifiche si gestiscono da qui.',
      },
      {
        target: '[data-tour="settings-property"]',
        title: 'Struttura',
        body: 'Dati condivisi come logo, fuso orario e contatti pubblici -- visibile solo a chi amministra la struttura.',
      },
      {
        target: '[data-tour="settings-modules"]',
        title: 'Impostazioni moduli',
        body: 'Configurazioni specifiche di ogni modulo attivo.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui puoi far ripartire questo tour quando vuoi.',
      },
    ],
  },
  moduli: {
    version: 1,
    steps: [
      {
        target: '[data-tour="modules-list"]',
        title: 'I moduli di questa struttura',
        body: 'Attivo o non attivo, a livello di struttura -- indipendente dai permessi dei singoli membri del team, che si gestiscono da Team.',
      },
      {
        target: '[data-tour="help-fab"]',
        title: 'Hai bisogno di aiuto?',
        body: 'Da qui puoi far ripartire questo tour quando vuoi.',
      },
    ],
  },
}
