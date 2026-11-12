import { useEffect, useRef, useState } from 'react'
import { CircleHelp, Compass } from 'lucide-react'
import { Button, Modal } from '@homisuite/ui'
import { helpTopicFor, moduleTours } from '../content/helpContent'
import { TourOverlay } from './TourOverlay'

const SEEN_STORAGE_KEY = 'homisuite.onboarding.seen.v1'
const SEEN_VERSIONS_KEY = 'homisuite.help.seenVersions.v1'

function readSeenVersions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEEN_VERSIONS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function markSeen(key: string, version: number) {
  try {
    const current = readSeenVersions()
    current[key] = version
    localStorage.setItem(SEEN_VERSIONS_KEY, JSON.stringify(current))
  } catch {
    // Private browsing or a blocked store -- the badge just won't clear,
    // no worse than not tracking it at all.
  }
}

// Present on every real-staff screen (mounted once in ShellLayout, not per
// page) so there's always the same "?" in the same place, regardless of
// which module is open. Clicking it always opens this screen's own guide
// (the HelpTopic modal below) -- it never jumps straight into the tour on
// its own, so it behaves the same everywhere and never fires something the
// person didn't ask for. When this module also has a real spotlight tour
// (moduleTours), the guide's footer carries a "Rivedi il tour" action that
// starts it on demand. The one tour that still launches on its own is the
// Home one, the very first time this browser ever sees a 'ready' shell --
// a one-time welcome, not something this button triggers afterward.
export function HelpButton({ moduleKey }: { moduleKey: string }) {
  const [open, setOpen] = useState(false)
  const [activeTourKey, setActiveTourKey] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [hasUpdate, setHasUpdate] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const autoShown = useRef(false)
  const topic = helpTopicFor(moduleKey)
  const tour = moduleTours[moduleKey]

  // Re-checks whenever the open screen changes (navigating to a different
  // module) or the guide closes (closing marks whatever was just viewed as
  // seen, which should clear its own badge immediately).
  useEffect(() => {
    const seen = readSeenVersions()
    setHasUpdate(topic.version > (seen[moduleKey] ?? 0))
  }, [moduleKey, open, topic.version])

  useEffect(() => {
    if (autoShown.current) return
    autoShown.current = true
    // The full-screen spotlight walkthrough assumes room to scroll a target
    // into view under a floating card -- cramped and easy to lose track of
    // on a phone-width screen. Mobile's first-time guidance stays to the
    // manually-opened "?" guide below, never this auto-launch (not marked
    // seen either, so a later visit from a wide-enough viewport still gets
    // the real tour once).
    if (window.matchMedia('(max-width: 920px)').matches) return
    let seen = true
    try {
      seen = localStorage.getItem(SEEN_STORAGE_KEY) === '1'
    } catch {
      seen = true // Can't tell -- better to stay quiet than interrupt every load.
    }
    if (seen) return
    setActiveTourKey('home')
    try {
      localStorage.setItem(SEEN_STORAGE_KEY, '1')
    } catch {
      // Private browsing or a blocked store -- it'll just show again next
      // time, no worse than never having set it.
    }
    // Only runs once, on this component's first mount -- intentionally not
    // re-checked when moduleKey changes (switching modules isn't "opening
    // the app for the first time" again).
  }, [])

  function onFabClick() {
    setStepIndex(0)
    setOpen(true)
  }

  function closeGuide() {
    markSeen(moduleKey, topic.version)
    setOpen(false)
  }

  function startTour() {
    markSeen(moduleKey, topic.version)
    setOpen(false)
    setActiveTourKey(moduleKey)
  }

  const activeTourSteps = activeTourKey ? moduleTours[activeTourKey]?.steps : undefined
  const isLast = stepIndex === topic.sections.length - 1
  const section = topic.sections[stepIndex]!
  const Icon = section.icon

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-tour="help-fab"
        className={`help-fab${hasUpdate ? ' has-update' : ''}`}
        aria-label={hasUpdate ? 'Guida di questa sezione (aggiornata)' : 'Guida di questa sezione'}
        onClick={onFabClick}
      >
        <CircleHelp size={22} />
        {hasUpdate ? <span className="help-fab-dot" aria-hidden="true" /> : null}
      </button>

      {activeTourSteps ? <TourOverlay steps={activeTourSteps} onFinish={() => setActiveTourKey(null)} /> : null}

      <Modal
        open={open}
        title={topic.title}
        description={topic.intro}
        onClose={closeGuide}
        originRef={triggerRef}
        footer={
          <div className="help-footer">
            <div className="help-dots" role="tablist" aria-label="Passi della guida">
              {topic.sections.map((item, index) => (
                <button
                  key={item.heading}
                  type="button"
                  role="tab"
                  aria-selected={index === stepIndex}
                  aria-label={`Passo ${index + 1} di ${topic.sections.length}: ${item.heading}`}
                  className={`help-dot${index === stepIndex ? ' is-active' : ''}`}
                  onClick={() => setStepIndex(index)}
                />
              ))}
            </div>
            <div className="help-footer-actions">
              {tour ? (
                <Button variant="secondary" className="push-left" onClick={startTour}>
                  <Compass size={15} /> Rivedi il tour
                </Button>
              ) : null}
              {stepIndex > 0 ? (
                <Button variant="secondary" onClick={() => setStepIndex((value) => value - 1)}>Indietro</Button>
              ) : null}
              {isLast ? (
                <Button variant="primary" onClick={closeGuide}>Ho capito</Button>
              ) : (
                <Button variant="primary" onClick={() => setStepIndex((value) => value + 1)}>Avanti</Button>
              )}
            </div>
          </div>
        }
      >
        {/* Keying on stepIndex remounts this block on every step change,
            which is what re-triggers the CSS entrance animation below --
            cheaper and more robust than hand-rolling a transition group
            for what's at most a handful of steps. */}
        <div className="help-step" key={stepIndex}>
          <div className="help-step-icon"><Icon size={26} /></div>
          <h3>{section.heading}</h3>
          <ul>
            {section.body.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </Modal>
    </>
  )
}
