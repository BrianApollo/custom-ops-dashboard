import { Check, ChevronRight, CircleAlert, CircleCheck, Rocket } from 'lucide-react'
import { Checkbox, Collapsible } from 'radix-ui'
import { checkbox } from '../../components/DataTable'
import { button, Tip } from '../../components/ui'
import type { Check as ChecklistItem, Creative, Draft } from './draft'

interface Props {
  draft: Draft
  onChange: (changes: Partial<Draft>) => void
  groups: { group: string; checks: ChecklistItem[] }[]
  chosenVideos: Creative[]
  chosenImages: Creative[]
  // opens the confirmation; nothing is created before the user confirms there
  onLaunch: () => void
}

function Chosen({ noun, items }: { noun: string; items: Creative[] }) {
  return (
    <Collapsible.Root className="border-t border-neutral-200 px-5 py-3">
      <Collapsible.Trigger
        disabled={items.length === 0}
        className="group flex w-full items-center gap-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-blue-700 disabled:text-neutral-500"
      >
        <ChevronRight className="size-4 group-data-[state=open]:rotate-90" />
        {items.length} {noun}
      </Collapsible.Trigger>
      <Collapsible.Content>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pl-6 text-sm text-neutral-700">
          {items.map((item) => (
            <li key={item.id} className="truncate" title={item.name}>
              {item.name}
            </li>
          ))}
        </ul>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

// Right panel: what is still missing, what was picked, and the launch button
export function ChecklistPanel({ draft, onChange, groups, chosenVideos, chosenImages, onLaunch }: Props) {
  const missing = groups.flatMap(({ checks }) => checks).filter((check) => !check.ok).length

  return (
    <section className="rounded-lg border border-neutral-200 bg-white xl:sticky xl:top-6">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3">
        <h2 className="text-sm font-semibold">Checklist</h2>
        <span className={`text-xs font-medium ${missing ? 'text-red-700' : 'text-emerald-700'}`} aria-live="polite">
          {missing ? `${missing} to fix` : 'Ready'}
        </span>
      </div>

      <div className="space-y-4 px-5 py-4">
        {groups.map(({ group, checks }) => (
          <div key={group}>
            <h3 className="text-xs font-medium tracking-wide text-neutral-500 uppercase">{group}</h3>
            <ul className="mt-1.5 space-y-1">
              {checks.map((check) => (
                <li key={check.label} className={`flex items-center gap-2 text-sm ${check.ok ? 'text-neutral-600' : 'font-medium text-red-700'}`}>
                  {check.ok ? <CircleCheck className="size-4 shrink-0 text-emerald-600" /> : <CircleAlert className="size-4 shrink-0" />}
                  {check.label}
                  <span className="sr-only">{check.ok ? '(done)' : '(missing)'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Chosen noun={chosenVideos.length === 1 ? 'video' : 'videos'} items={chosenVideos} />
      <Chosen noun={chosenImages.length === 1 ? 'image' : 'images'} items={chosenImages} />

      <div className="space-y-3 border-t border-neutral-200 px-5 py-4">
        <label className="flex items-center gap-3 text-sm">
          <Checkbox.Root
            checked={draft.launchActive}
            onCheckedChange={(on) => onChange({ launchActive: on === true })}
            className={`${checkbox} shrink-0`}
          >
            <Checkbox.Indicator>
              <Check className="size-3" />
            </Checkbox.Indicator>
          </Checkbox.Root>
          Launch as active immediately
        </label>
        <Tip label={missing ? 'Fix the checklist first' : 'Review what will be created, then launch'}>
          {/* a disabled button fires no pointer events, so the span carries the tooltip */}
          <span tabIndex={missing ? 0 : undefined} className="block">
            <button type="button" disabled={missing > 0} onClick={onLaunch} className={`${button.primary} h-10 w-full`}>
              <Rocket className="size-4" />
              Launch campaign…
            </button>
          </span>
        </Tip>
      </div>
    </section>
  )
}
