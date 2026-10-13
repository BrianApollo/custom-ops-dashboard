import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { Label } from 'radix-ui'
import { useEffect, useState, type ReactNode } from 'react'
import { button, input, Tip } from '../ui'

// Copies without ever showing the value; the tick clears itself
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 1500)
    return () => clearTimeout(timer)
  }, [state])

  const tip = state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : `Copy ${label}`
  return (
    <Tip label={tip}>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        disabled={!value}
        onClick={() => navigator.clipboard.writeText(value).then(() => setState('copied'), () => setState('failed'))}
        className={`${button.icon} shrink-0`}
      >
        {state === 'copied' ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
      </button>
    </Tip>
  )
}

interface FieldProps {
  id: string
  label: string
  value: string
  // differs from what is stored
  dirty: boolean
  onChange: (value: string) => void
  hint?: string
  multiline?: boolean
  // shown under the field, e.g. how it compares with the delivered value
  note?: ReactNode
}

const dirtyRing = 'border-amber-500 ring-1 ring-amber-500'

function FieldFrame({ id, label, dirty, hint, note, children }: Pick<FieldProps, 'id' | 'label' | 'dirty' | 'hint' | 'note'> & { children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <Label.Root htmlFor={id} className="text-sm font-medium">
          {label}
        </Label.Root>
        {dirty && <span className="text-xs font-medium text-amber-700">Edited</span>}
      </div>
      <div className="mt-1.5 flex items-start gap-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
      {note}
    </div>
  )
}

export function TextField({ id, label, value, dirty, onChange, hint, multiline, note }: FieldProps) {
  return (
    <FieldFrame id={id} label={label} dirty={dirty} hint={hint} note={note}>
      {multiline ? (
        <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={`${input} ${dirty ? dirtyRing : ''}`} />
      ) : (
        <input id={id} value={value} autoComplete="off" onChange={(e) => onChange(e.target.value)} className={`${input} ${dirty ? dirtyRing : ''}`} />
      )}
      <CopyButton value={value} label={label} />
    </FieldFrame>
  )
}

// A password, 2FA secret, recovery code or token: masked until revealed.
// It can be copied while masked, so it need not be put on screen to be used.
export function SecretField({ id, label, value, dirty, onChange, hint, multiline, note }: FieldProps) {
  const [shown, setShown] = useState(false)

  return (
    <FieldFrame id={id} label={label} dirty={dirty} hint={hint} note={note}>
      {multiline && !shown ? (
        // a textarea cannot mask its text, so the hidden state is a stand-in that opens it
        <button
          type="button"
          id={id}
          onClick={() => setShown(true)}
          className={`${input} text-left text-neutral-500 hover:bg-neutral-50 ${dirty ? dirtyRing : ''}`}
        >
          {value ? `Hidden (${value.length.toLocaleString()} characters). Show to read or edit.` : 'Not set. Show to add.'}
        </button>
      ) : multiline ? (
        <textarea
          id={id}
          rows={4}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          className={`${input} font-mono ${dirty ? dirtyRing : ''}`}
        />
      ) : (
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          placeholder="Not set"
          spellCheck={false}
          // these are not the user's own login, so the browser should not offer to save or fill them
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          onChange={(e) => onChange(e.target.value)}
          className={`${input} ${shown ? 'font-mono' : ''} ${dirty ? dirtyRing : ''}`}
        />
      )}
      <Tip label={shown ? `Hide ${label}` : `Show ${label}`}>
        <button
          type="button"
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
          className={`${button.icon} shrink-0`}
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </Tip>
      <CopyButton value={value} label={label} />
    </FieldFrame>
  )
}
