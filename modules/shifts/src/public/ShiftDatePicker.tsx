import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre']
const WEEKDAYS = ['lu','ma','me','gi','ve','sa','do']

function parseIso(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year || 2026, (month || 1) - 1, day || 1)
}
function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
function formatDisplay(value: string) {
  const date=parseIso(value)
  return new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'}).format(date)
}

export function ShiftDatePicker({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }) {
  const selected=parseIso(value)
  const [open,setOpen]=useState(false)
  const [visible,setVisible]=useState(()=>new Date(selected.getFullYear(),selected.getMonth(),1))
  const rootRef=useRef<HTMLDivElement>(null)
  const triggerRef=useRef<HTMLButtonElement>(null)
  const dayRefs=useRef<Record<string,HTMLButtonElement|null>>({})

  function dismiss(){ setOpen(false); requestAnimationFrame(()=>triggerRef.current?.focus()) }

  useEffect(()=>{
    if(!open)return
    const closeOnOutside=(event:PointerEvent)=>{ if(!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const closeOnEscape=(event:KeyboardEvent)=>{ if(event.key==='Escape'){ event.preventDefault(); dismiss() } }
    document.addEventListener('pointerdown',closeOnOutside)
    document.addEventListener('keydown',closeOnEscape)
    ;(dayRefs.current[value] ?? dayRefs.current[toIso(new Date())])?.focus()
    return()=>{
      document.removeEventListener('pointerdown',closeOnOutside)
      document.removeEventListener('keydown',closeOnEscape)
    }
  },[open,value])

  const cells=useMemo(()=>{
    const year=visible.getFullYear(), month=visible.getMonth()
    const first=(new Date(year,month,1).getDay()+6)%7
    const days=new Date(year,month+1,0).getDate()
    const previous=new Date(year,month,0).getDate()
    return Array.from({length:42},(_,index)=>{
      const relative=index-first+1
      if(relative<1)return {date:new Date(year,month-1,previous+relative),outside:true}
      if(relative>days)return {date:new Date(year,month+1,relative-days),outside:true}
      return {date:new Date(year,month,relative),outside:false}
    })
  },[visible])

  function choose(date:Date){ onChange(toIso(date)); setVisible(new Date(date.getFullYear(),date.getMonth(),1)); setOpen(false); requestAnimationFrame(()=>triggerRef.current?.focus()) }

  return <div className={`shift-date-picker${open?' is-open':''}`} ref={rootRef}>
    <button ref={triggerRef} className="shift-date-trigger" type="button" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
      <span>{formatDisplay(value)}</span><CalendarDays size={15} aria-hidden="true" />
    </button>
    {open ? <div className="shift-date-popover" role="dialog" aria-label={ariaLabel}>
      <div className="shift-date-head">
        <strong>{MONTHS[visible.getMonth()]} {visible.getFullYear()}</strong>
        <span><button type="button" aria-label="Mese precedente" onClick={()=>setVisible(d=>new Date(d.getFullYear(),d.getMonth()-1,1))}><ChevronLeft size={17}/></button><button type="button" aria-label="Mese successivo" onClick={()=>setVisible(d=>new Date(d.getFullYear(),d.getMonth()+1,1))}><ChevronRight size={17}/></button></span>
      </div>
      <div className="shift-date-grid">{WEEKDAYS.map(day=><b key={day}>{day}</b>)}{cells.map(({date,outside})=>{
        const iso=toIso(date), active=iso===value, today=iso===toIso(new Date())
        return <button key={iso} ref={(element)=>{ dayRefs.current[iso]=element }} type="button" className={`${outside?' is-outside':''}${active?' is-selected':''}${today?' is-today':''}`} onClick={()=>choose(date)}>{date.getDate()}</button>
      })}</div>
      <div className="shift-date-footer"><button type="button" onClick={dismiss}>Cancella</button><button type="button" onClick={()=>choose(new Date())}>Oggi</button></div>
    </div> : null}
  </div>
}
