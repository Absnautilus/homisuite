import { useEffect, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { Button, Modal } from '@homisuite/ui'
import { APP_TOUR_VERSION, appTourSteps, helpTopicFor } from '../content/helpContent'
import { TourOverlay } from './TourOverlay'

const SEEN_STORAGE_KEY = 'homisuite.onboarding.seen.v1'
const SEEN_VERSIONS_KEY = 'homisuite.help.seenVersions.v1'
const TOUR_SEEN_KEY = '__tour__'

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
// which module is open. Three jobs: on Home, launches the real spotlight
// tour over the actual sidebar/modules/help button (TourOverlay) rather
// than describing them in a modal -- the first time this browser ever sees
// a 'ready' shell, on its own, and again any time afterward from this
// button. On every other screen, shows that screen's own short animated
// guide, badging itself when its content has changed since this browser
// last saw it (helpContent.ts's own `version` field -- see its doc
// comment for what this does and doesn't automate).
export function HelpButton({ moduleKey }: { moduleKey: string }) {
  const [open, setOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [hasUpdate, setHasUpdate] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const autoShown = useRef(false)
  const isHome = moduleKey === 'home'

  const topic = helpTopicFor(moduleKey)

  // Re-checks whenever the open screen changes (navigating to a different
  // module) or a panel closes (closing marks whatever was just viewed as
  // seen, which should clear its own badge immediately).
  useEffect(() => {
    const seen = readSeenVersions()
    const currentVersion = isHome ? APP_TOUR_VERSION : topic.version
    const seenKey = isHome ? TOUR_SEEN_KEY : moduleKey
    setHasUpdate(currentVersion > (seen[seenKey] ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey, open, tourOpen])

  useEffect(() => {
    if (autoShown.current) return
    autoShown.current = true
    let seen = true
    try {
      seen = localStorage.getItem(SEEN_STORAGE_KEY) === '1'
    } catch {
      seen = true // Can't tell -- better to stay quiet than interrupt every load.
    }
    if (seen) return
    setTourOpen(true)
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
    if (isHome) {
      setTourOpen(true)
    } else {
      setStepIndex(0)
      setOpen(true)
    }
  }

  function closeGuide() {
    markSeen(moduleKey, topic.version)
    setOpen(false)
  }

  function closeTour() {
    markSeen(TOUR_SEEN_KEY, APP_TOUR_VERSION)
    setTourOpen(false)
  }

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

      {tourOpen ? <TourOverlay steps={appTourSteps} onFinish={closeTour} /> : null}

      {!isHome && (
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
      )}
    </>
  )
}
