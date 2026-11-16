import { Globe, GripVertical, Link2, Mail, Pencil, Settings, Shield, User, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { useAuth } from '../../auth'
import { api, ApiError, type ApiRecord } from '../../lib/api'
import { button } from '../ui'
import { F } from './model'
import {
  ADD_FIELDS,
  ADD_GROUPS,
  BAD_MESSAGE,
  fits,
  GREY,
  guessAll,
  hueOf,
  loadLayouts,
  partsOf,
  readRecords,
  REQUIRED,
  saveLayouts,
  SEPARATORS,
  SHORT,
  type AddKey,
  type Layout,
  type Part,
  type Separator,
} from './parse'

// Adding a profile from what the supplier sent. The string is split into
// numbered parts on the left; each part is connected to one field on the
// right by a coloured wire, drawn by dragging. A part lives in one field at
// most, so nothing is ever duplicated. The form can also be typed in by hand.

interface Props {
  onClose: () => void
  onCreated: (id: string) => void
}

const GROUP_ICON: Record<string, LucideIcon> = { Profile: User, Facebook: Globe, Mailbox: Mail, 'Recovery mailbox': Shield, Other: Settings }

const tint = (hue: string, pct: number) => `color-mix(in srgb, ${hue} ${pct}%, #fff)`

type Conn = Partial<Record<AddKey, number>>
type Typed = Partial<Record<AddKey, string>>

export function AddProfile({ onClose, onCreated }: Props) {
  const { expire } = useAuth()
  const [mode, setMode] = useState<'map' | 'manual'>('map')
  const [pasted, setPasted] = useState('')
  const [sep, setSep] = useState<Separator>('auto')
  const [auto, setAuto] = useState(true)
  const [unusedToNotes, setUnusedToNotes] = useState(true)
  const [records, setRecords] = useState<string[]>([])
  const [line, setLine] = useState(0)
  const [parts, setParts] = useState<Part[]>([])
  const [usedSep, setUsedSep] = useState<Separator | null>(null)
  const [conn, setConn] = useState<Conn>({})
  const [guessed, setGuessed] = useState<Set<AddKey>>(new Set())
  const [typed, setTyped] = useState<Typed>({})
  // the supplier sends one address: it is the Facebook login and the mailbox
  const [same, setSame] = useState(true)
  const [picked, setPicked] = useState<number | null>(null)
  // position in the line -> field, learned from the connections made on line 1 or a saved layout
  const [posMap, setPosMap] = useState<Record<number, AddKey>>({})
  const [layouts, setLayouts] = useState(loadLayouts)
  const [layout, setLayout] = useState('')
  const [layoutName, setLayoutName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [addedCount, setAddedCount] = useState(0)
  const wiresRef = useRef<SVGSVGElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  const fieldOfPart = useCallback((index: number) => (Object.keys(conn) as AddKey[]).find((key) => conn[key] === index), [conn])
  const value = useCallback(
    (key: AddKey): string => {
      if (key === 'email' && same) return value('fbEmail')
      const index = conn[key]
      return index !== undefined ? (parts[index]?.value ?? '') : (typed[key] ?? '')
    },
    [conn, parts, typed, same],
  )

  // ---- paste -> parts -> connections ----
  const loadLine = useCallback(
    (lines: string[], i: number, map: Record<number, AddKey>, separator: Separator, detect: boolean) => {
      const record = lines[i]
      if (record === undefined) return
      const { parts: found, used } = partsOf(record, separator)
      setParts(found)
      setUsedSep(used)
      setLine(i)
      const next: Conn = {}
      const guesses = new Set<AddKey>()
      for (const part of found) {
        const key = map[part.index]
        if (key && next[key] === undefined) next[key] = part.index
      }
      if (detect) {
        const connected = new Set(Object.values(next))
        for (const [index, guess] of guessAll(found.filter((part) => !connected.has(part.index)))) {
          if (next[guess.key] === undefined) {
            next[guess.key] = index
            if (!guess.sure) guesses.add(guess.key)
          }
        }
      }
      setConn(next)
      setGuessed(guesses)
      setTyped({})
      setSame(true)
      setPicked(null)
    },
    [],
  )

  const run = useCallback(
    (text: string, separator: Separator, detect: boolean, map: Record<number, AddKey>) => {
      const lines = readRecords(text, separator)
      setRecords(lines)
      if (lines.length === 0) {
        setParts([])
        setConn({})
        setGuessed(new Set())
        setLine(0)
        return
      }
      loadLine(lines, 0, map, separator, detect)
    },
    [loadLine],
  )

  // parts follow the text as it is typed or pasted
  useEffect(() => {
    const timer = setTimeout(() => run(pasted, sep, auto, layout ? (layouts[layout]?.map as Record<number, AddKey>) : {}), 200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasted, sep, auto, layout])

  function connect(index: number, key: AddKey) {
    if (!parts[index]) return
    const previous = fieldOfPart(index)
    if (previous === key) return
    if (key === 'email') setSame(false)
    setConn((conn) => {
      const next = { ...conn }
      if (previous) delete next[previous]
      next[key] = index
      return next
    })
    setGuessed((set) => {
      const next = new Set(set)
      next.delete(key)
      if (previous) next.delete(previous)
      return next
    })
    setTyped((typed) => ({ ...typed, [key]: undefined }))
    setPosMap((map) => {
      const next = { ...map }
      for (const k of Object.keys(next)) if (next[Number(k)] === key) delete next[Number(k)]
      next[parts[index].index] = key
      return next
    })
    setPicked(null)
  }

  function disconnect(key: AddKey) {
    const index = conn[key]
    if (index === undefined) return
    setConn((conn) => {
      const next = { ...conn }
      delete next[key]
      return next
    })
    setGuessed((set) => {
      const next = new Set(set)
      next.delete(key)
      return next
    })
    setPosMap((map) => {
      const next = { ...map }
      for (const k of Object.keys(next)) if (next[Number(k)] === key) delete next[Number(k)]
      return next
    })
  }

  function type(key: AddKey, text: string) {
    if (conn[key] !== undefined) disconnect(key)
    setTyped((typed) => ({ ...typed, [key]: text }))
  }

  function onDrop(event: DragEvent, key: AddKey) {
    event.preventDefault()
    const data = event.dataTransfer.getData('text/plain')
    if (data !== '') connect(Number(data), key)
  }

  // ---- wires ----
  const draw = useCallback(() => {
    const svg = wiresRef.current
    const board = boardRef.current
    if (!svg || !board) return
    if (mode === 'manual') {
      svg.innerHTML = ''
      return
    }
    const box = board.getBoundingClientRect()
    let out = ''
    for (const key of Object.keys(conn) as AddKey[]) {
      const index = conn[key]!
      const a = board.querySelector(`[data-part-port="${index}"]`)
      const b = board.querySelector(`[data-field-port="${key}"]`)
      if (!a || !b) continue
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const x1 = ra.left + ra.width / 2 - box.left
      const y1 = ra.top + ra.height / 2 - box.top
      const x2 = rb.left + rb.width / 2 - box.left
      const y2 = rb.top + rb.height / 2 - box.top
      const dx = Math.max(40, (x2 - x1) / 2)
      out += `<path d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}" stroke="${hueOf(key)}" fill="none" stroke-width="2.2" stroke-linecap="round"${guessed.has(key) ? ' stroke-dasharray="5 5" opacity="0.6"' : ''}/>`
    }
    svg.innerHTML = out
  }, [conn, guessed, mode])

  useLayoutEffect(draw, [draw, parts, same, typed])
  useEffect(() => {
    window.addEventListener('resize', draw)
    window.addEventListener('scroll', draw, true)
    const observer = new ResizeObserver(draw)
    if (boardRef.current) observer.observe(boardRef.current)
    return () => {
      window.removeEventListener('resize', draw)
      window.removeEventListener('scroll', draw, true)
      observer.disconnect()
    }
  }, [draw])

  // ---- checks ----
  const missing = REQUIRED.filter((key) => !value(key))
  const invalid = (Object.keys(ADD_FIELDS) as AddKey[]).filter((key) => !fits(key, value(key)))
  const unused = parts.filter((part) => fieldOfPart(part.index) === undefined)
  const ready = missing.length === 0 && invalid.length === 0 && !busy
  const niceName = (key: AddKey) => (['Email', 'Password'].includes(ADD_FIELDS[key].label) ? `${ADD_FIELDS[key].group} ${ADD_FIELDS[key].label.toLowerCase()}` : ADD_FIELDS[key].label)

  // ---- save ----
  async function add() {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    const v = (key: AddKey) => value(key).trim()
    let notes = v('notes')
    if (unused.length && unusedToNotes) notes = [notes, `Extra from supplier: ${unused.map((part) => part.value).join(' | ')}`].filter(Boolean).join('\n')
    const received: Record<string, string> = {
      userId: v('uid'),
      password: v('fbPassword'),
      twoFaKey: v('twoFa'),
      email: v('fbEmail'),
      emailPassword: v('emailPassword'),
      recoveryEmail: v('recoveryEmail'),
      recoveryEmailPassword: v('recoveryEmailPassword'),
      cookies: v('cookies'),
      proxy: v('proxy'),
    }
    for (const key of Object.keys(received)) if (!received[key]) delete received[key]
    // the Current column starts as the delivered values; the Received copy is locked by the server
    const fields: Record<string, unknown> = {
      [F.name]: v('name'),
      [F.status]: 'Active',
      [F.profileId]: v('uid'),
      [F.fbUid]: v('uid'),
      [F.uid]: v('uid'),
      [F.original]: JSON.stringify(received, null, 2),
      [F.fbEmail]: v('fbEmail'),
      [F.fbEmailSource]: 'received',
      [F.fbPassword]: v('fbPassword'),
      [F.twoFa]: v('twoFa'),
      [F.recoveryCodes]: v('recoveryCodes'),
      [F.mailboxEmail]: v('email'),
      [F.mailboxPassword]: v('emailPassword'),
      [F.recoveryEmail]: v('recoveryEmail'),
      [F.recoveryPassword]: v('recoveryEmailPassword'),
      [F.proxy]: v('proxy'),
      [F.notes]: notes,
    }
    try {
      const record = await api<ApiRecord>('/data/profiles', { method: 'POST', body: { fields } })
      setAddedCount((n) => n + 1)
      if (line < records.length - 1) {
        setBusy(false)
        loadLine(records, line + 1, posMap, sep, auto)
      } else {
        onCreated(record.id)
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expire()
      else setError((err as Error).message)
      setBusy(false)
    }
  }

  function saveLayout() {
    const name = layoutName.trim()
    if (!name || Object.keys(posMap).length === 0) return
    const next: Record<string, Layout> = { ...layouts, [name]: { sep: usedSep ?? 'auto', map: Object.fromEntries(Object.entries(posMap)) as Record<string, AddKey> } }
    saveLayouts(next)
    setLayouts(next)
    setLayout(name)
    setLayoutName('')
  }

  // ---- render ----
  const fieldRow = (key: AddKey) => {
    const field = ADD_FIELDS[key]
    const linked = conn[key] !== undefined
    const hue = hueOf(key)
    const v = value(key)
    const bad = !fits(key, v)
    const isSame = key === 'email' && same
    const inputStyle: CSSProperties = linked && !isSame ? { background: tint(hue, 7), borderColor: tint(hue, 40) } : {}
    const inputClass = `block min-h-9 w-full min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700 ${
      field.mono ? 'font-mono text-[13px]' : ''
    } ${bad ? 'border-red-400 bg-red-50' : isSame ? 'border-dashed border-neutral-300 bg-neutral-50 text-neutral-600' : linked ? '' : missing.includes(key) ? 'border-red-300 bg-red-50/40' : 'border-neutral-300 bg-white'}`
    return (
      <div
        key={key}
        className="relative grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 py-1"
        onDragOver={(e) => {
          e.preventDefault()
          e.currentTarget.dataset.over = '1'
        }}
        onDragLeave={(e) => delete e.currentTarget.dataset.over}
        onDrop={(e) => {
          delete e.currentTarget.dataset.over
          onDrop(e, key)
        }}
        onClick={() => picked !== null && connect(picked, key)}
      >
        <span
          data-field-port={key}
          className="absolute top-1/2 -left-[39px] size-3.5 -translate-y-1/2 rounded-full border-2"
          style={{ borderColor: linked && !isSame ? 'transparent' : hue, background: linked && !isSame ? hue : '#fff', opacity: isSame ? 0.35 : 1 }}
        />
        <label className="text-sm text-neutral-600">
          {field.label}
          {field.required && <span className="ml-0.5 text-red-700">*</span>}
        </label>
        <div className="flex min-w-0 items-center gap-1.5">
          {field.multiline ? (
            <textarea rows={2} value={v} readOnly={isSame} placeholder={field.placeholder} spellCheck={false} onChange={(e) => type(key, e.target.value)} className={inputClass} style={inputStyle} />
          ) : (
            <input value={v} readOnly={isSame} placeholder={field.placeholder} spellCheck={false} autoComplete="off" data-1p-ignore data-lpignore="true" onChange={(e) => type(key, e.target.value)} className={inputClass} style={inputStyle} />
          )}
          {bad && <span className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-red-700 uppercase">{BAD_MESSAGE[key]}</span>}
          {key === 'email' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (!same) disconnect('email')
                setSame(!same)
              }}
              title="The supplier sends one address: it is the Facebook login and the mailbox. Switch this off if they sent a different mailbox."
              className={`h-6 shrink-0 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap ${same ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-neutral-300 bg-white text-neutral-600'}`}
            >
              {same ? 'Same as Facebook ✓' : 'Different mailbox'}
            </button>
          )}
          {linked && !isSame && (
            <button type="button" aria-label="Disconnect" onClick={() => disconnect(key)} className="flex size-6 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    )
  }

  const partRow = (part: Part) => {
    const key = fieldOfPart(part.index)
    const hue = key ? hueOf(key) : GREY
    const bad = key ? !fits(key, part.value) : false
    const label = key ? `${SHORT[key]}${guessed.has(key) ? '?' : ''}` : 'unused'
    return (
      <div
        key={part.index}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', String(part.index))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => setPicked(picked === part.index ? null : part.index)}
        onDoubleClick={() => key && disconnect(key)}
        title={key ? `Connected to ${niceName(key)}${guessed.has(key) ? ' (best guess, check it)' : ''}. Drag to another field to move it.` : 'Not connected. Drag onto a field, or leave it for Notes.'}
        className={`relative flex h-9 cursor-grab items-center rounded-lg border bg-white select-none hover:shadow-sm active:cursor-grabbing ${picked === part.index ? 'border-blue-700 ring-2 ring-blue-100' : 'border-neutral-200'}`}
      >
        <GripVertical className="ml-1 size-3.5 text-neutral-400" />
        <span className="flex h-full w-8 items-center justify-center border-r border-black/5 text-sm font-semibold" style={{ color: hue, background: tint(hue, 12) }}>
          {part.index + 1}
        </span>
        <span className={`min-w-0 flex-1 truncate px-3 ${/@/.test(part.value) ? 'text-sm' : 'font-mono text-[13px]'} ${key ? '' : 'text-neutral-500'}`}>{part.value}</span>
        <span
          className="mr-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
          style={bad ? { background: '#fef2f2', color: '#b91c1c' } : { background: key ? tint(hue, 12) : '#f3f4f6', color: key ? hue : '#737373' }}
        >
          {label}
        </span>
        <span data-part-port={part.index} className="absolute top-1/2 -right-[7px] size-3.5 -translate-y-1/2 rounded-full border-2 bg-white" style={{ borderColor: key ? 'transparent' : '#d4d4d4', background: key ? hue : '#fff' }} />
      </div>
    )
  }

  const tab = (value: 'map' | 'manual', label: string, Icon: LucideIcon) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium ${mode === value ? 'bg-blue-700 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
    >
      <Icon className="size-4" /> {label}
    </button>
  )

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold">Add profile</h2>
          <p className="text-sm text-neutral-600">Paste the supplier string and connect each part to the right field, or type it in.</p>
        </div>
        <div className="ml-auto inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
          {tab('map', 'Paste & map', Link2)}
          {tab('manual', 'Enter manually', Pencil)}
        </div>
      </div>

      <div ref={boardRef} className={`relative grid items-start gap-6 ${mode === 'manual' ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <svg ref={wiresRef} className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible" aria-hidden />

        {mode === 'map' && (
          <section className="rounded-lg border border-neutral-200 bg-white p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-5 items-center justify-center rounded-full bg-blue-50 text-[11px] text-blue-800 ring-1 ring-blue-200">1</span> Paste supplier string
            </h3>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="61575394211177|Clone2025SaPofN|6E2EOXVCUNZDONCJC4DMEQ262NZF2CMV|name@outlook.com|…"
              className="mt-3 block w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className={parts.length ? 'text-emerald-700' : 'text-neutral-500'}>
                {parts.length} part{parts.length === 1 ? '' : 's'} detected
              </span>
              <span className="ml-auto flex items-center gap-1" title="How to split the string">
                {SEPARATORS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSep(option.value)}
                    className={`h-6 min-w-6 rounded-full border px-2 font-mono text-xs ${sep === option.value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-600'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </span>
              <button type="button" onClick={() => setPasted('')} className={`${button.secondary} h-7 px-2.5 text-xs`}>
                Clear
              </button>
            </div>

            <h3 className="mt-6 flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-5 items-center justify-center rounded-full bg-blue-50 text-[11px] text-blue-800 ring-1 ring-blue-200">2</span> Connect the parts
              <span className="font-normal text-neutral-500">(in original order, drag a part onto a field)</span>
            </h3>
            <div className="mt-3 space-y-2">
              {parts.length === 0 && <p className="py-4 text-sm text-neutral-400 italic">Paste a string above and its parts appear here.</p>}
              {parts.map(partRow)}
            </div>

            {records.length > 1 && (
              <div className="mt-4 flex items-center gap-2 border-t border-neutral-200 pt-3 text-sm text-neutral-600">
                <button type="button" disabled={line === 0} onClick={() => loadLine(records, line - 1, posMap, sep, auto)} className={`${button.secondary} h-7 px-2`}>
                  ‹
                </button>
                <span>
                  Line {line + 1} of {records.length}
                </span>
                <button type="button" disabled={line >= records.length - 1} onClick={() => loadLine(records, line + 1, posMap, sep, auto)} className={`${button.secondary} h-7 px-2`}>
                  ›
                </button>
                <span className="ml-auto text-xs text-neutral-500">{Object.keys(posMap).length ? `${Object.keys(posMap).length} positions mapped, reused on every line` : 'connect line 1; the layout repeats'}</span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-neutral-500">Layout</span>
              <select value={layout} onChange={(e) => setLayout(e.target.value)} className="h-7 rounded-md border border-neutral-300 bg-white px-2 text-xs">
                <option value="">Auto-detect</option>
                {Object.keys(layouts).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
              <input value={layoutName} onChange={(e) => setLayoutName(e.target.value)} placeholder="Save as… (supplier name)" className="h-7 w-44 rounded-md border border-neutral-300 px-2 text-xs" />
              <button type="button" onClick={saveLayout} disabled={!layoutName.trim() || Object.keys(posMap).length === 0} className={`${button.secondary} h-7 px-2.5 text-xs`}>
                Save
              </button>
            </div>
          </section>
        )}

        <section className={`rounded-lg border border-neutral-200 bg-white ${mode === 'manual' ? 'mx-auto w-full max-w-3xl' : ''}`}>
          <div className="flex items-center gap-2 px-5 pt-4">
            <h3 className="text-sm font-semibold">Profile details</h3>
            <span className="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
              {REQUIRED.length - missing.length} of {REQUIRED.length} required
            </span>
          </div>
          {ADD_GROUPS.map((group) => {
            const Icon = GROUP_ICON[group.name]
            const hue = hueOf(group.fields[0].key)
            return (
              <div key={group.name} className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-3 border-t border-neutral-100 px-5 py-3 first-of-type:border-t-0">
                <span className="flex size-7 items-center justify-center rounded-lg" style={{ background: tint(hue, 12), color: hue }}>
                  <Icon className="size-4" />
                </span>
                <p className="pt-1 text-sm font-semibold">{group.name}</p>
                <div className="col-start-2">{group.fields.map((field) => fieldRow(field.key))}</div>
              </div>
            )
          })}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-5 rounded-lg border border-neutral-200 bg-white px-5 py-3 text-sm">
        {mode === 'map' && (
          <>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="size-4 accent-blue-700" /> Auto-detect obvious fields
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={unusedToNotes} onChange={(e) => setUnusedToNotes(e.target.checked)} className="size-4 accent-blue-700" /> Put unused parts in Notes
            </label>
            {guessed.size > 0 && <span className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Best guess (dashed): {[...guessed].map(niceName).join(', ')}</span>}
            {unused.length > 0 && <span className={`rounded-md px-2 py-1 text-xs ${unusedToNotes ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{unused.length} unused part{unused.length > 1 ? 's' : ''} {unusedToNotes ? '→ Notes' : 'will be dropped'}</span>}
          </>
        )}
        <span className="ml-auto text-xs text-neutral-500">
          {invalid.length ? (
            <>
              Check: <span className="text-red-700">{invalid.map(niceName).join(', ')}</span>
            </>
          ) : missing.length ? (
            <>
              Missing: <span className="text-red-700">{missing.map(niceName).join(', ')}</span>
            </>
          ) : (
            'Ready. Received values lock once saved.'
          )}
          {addedCount > 0 && ` · ${addedCount} added`}
        </span>
        {error && (
          <p role="alert" className="w-full text-sm text-red-700">
            {error}
          </p>
        )}
        <button type="button" onClick={onClose} className={button.secondary}>
          Cancel
        </button>
        <button type="button" disabled={!ready} onClick={() => void add()} className={button.primary}>
          {busy ? 'Adding…' : line < records.length - 1 ? 'Add & next line' : 'Add profile'}
        </button>
      </div>
    </div>
  )
}
