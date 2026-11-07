import { useEffect, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { Button, Modal } from '@homisuite/ui'
import { GENERAL_HELP_KEY, helpTopicFor } from '../content/helpContent'

const SEEN_STORAGE_KEY = 'homisuite.onboarding.seen.v1'

// Present on every real-staff screen (mounted once in ShellLayout, not per
// page) so there's always the same "?" in the same place, regardless of
// which module is open -- rather than each module building its own help
// affordance. Two jobs: shows the current screen's guide on demand, and --
// the first time this browser ever sees a 'ready' shell -- opens once on
// its own with the general orientation, before the person has had to ask.
// Per-browser, not per-account (no backend column exists for "has this
// person seen onboarding"), the same storage-only convention this app
// already uses for the active property and the theme choice.
export function HelpButton({ moduleKey }: { moduleKey: string }) {
  const [open, setOpen] = useState(false)
  const [topicKey, setTopicKey] = useState(moduleKey)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const autoShown = useRef(false)

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
    setTopicKey(GENERAL_HELP_KEY)
    setOpen(true)
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

  const topic = helpTopicFor(topicKey)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="help-fab"
        aria-label="Guida di questa sezione"
        onClick={() => { setTopicKey(moduleKey); setOpen(true) }}
      >
        <CircleHelp size={22} />
      </button>
      <Modal
        open={open}
        title={topic.title}
        description={topic.intro}
        onClose={() => setOpen(false)}
        originRef={triggerRef}
        footer={<Button variant="primary" onClick={() => setOpen(false)}>Ho capito</Button>}
      >
        <div className="help-sections">
          {topic.sections.map((section) => (
            <div className="help-section" key={section.heading}>
              <h3>{section.heading}</h3>
              <ul>
                {section.body.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
