import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { useRecords, type Product } from '../data'
import { api, text } from '../lib/api'
import { button, input, Select } from './ui'

const MODELS = [
  { value: 'nanobanana-1', label: 'Nanobanana-1' },
  { value: 'nanobanana-2', label: 'Nanobanana-2' },
]
const SIZES = ['Auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']
const FORMATS = ['png', 'jpeg', 'jpg'].map((value) => ({ value, label: value.toUpperCase() }))
const MAX_IMAGES = 20

interface Props {
  product: Product
  onClose: () => void
  // the job the server started and how many images it was asked for
  onStarted: (jobId: string, count: number) => void
}

// Starts an image-generation job for one product. The job runs on the server
// in the background and adds each image as a New image when it is ready.
export function CreateImagesDialog({ product, onClose, onStarted }: Props) {
  const advertorials = useRecords('advertorials', { fields: 'Advertorial Name,Advertorial Text', 'where[Product]': product.id })
  const [model, setModel] = useState(MODELS[0].value)
  const [count, setCount] = useState('1')
  const [advertorialId, setAdvertorialId] = useState('')
  const [size, setSize] = useState('9:16')
  const [format, setFormat] = useState(FORMATS[0].value)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const options = (advertorials.records ?? []).map((record) => ({
    value: record.id,
    label: text(record, 'Advertorial Name') || 'Untitled',
  }))
  const number = Number(count)
  const valid = Number.isInteger(number) && number >= 1 && number <= MAX_IMAGES && advertorialId !== ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      // The server uses the product's logo as the reference image and its own
      // standing instructions for the prompt writers.
      const started = await api<{ jobId: string }>('/image-generation', {
        method: 'POST',
        body: {
          model,
          // the advertorial's full text, not its id
          advertorial: text(advertorials.records!.find((record) => record.id === advertorialId)!, 'Advertorial Text'),
          image_count: number,
          image_size: size,
          output_format: format,
          product_id: product.id,
        },
      })
      onStarted(started.jobId, number)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const field = 'mt-1.5 h-9.5 w-full'

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Create images</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            Generated images for {product.name} appear under New as each one is ready.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label.Root htmlFor="image-model" className="text-sm font-medium">
                Image generation model
              </Label.Root>
              <Select id="image-model" value={model} options={MODELS} onValueChange={setModel} className={field} />
            </div>
            <div>
              <Label.Root htmlFor="image-count" className="text-sm font-medium">
                Number of images
              </Label.Root>
              <input
                id="image-count"
                type="number"
                min={1}
                max={MAX_IMAGES}
                required
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className={`${input} mt-1.5`}
              />
              <p className="mt-1 text-xs text-neutral-500">1 to {MAX_IMAGES}</p>
            </div>
            <div>
              <Label.Root htmlFor="image-advertorial" className="text-sm font-medium">
                Advertorial
              </Label.Root>
              <Select
                id="image-advertorial"
                value={advertorialId}
                options={options}
                placeholder={advertorials.records ? 'Choose an advertorial' : 'Loading…'}
                onValueChange={setAdvertorialId}
                className={field}
              />
              {advertorials.error && <p className="mt-1 text-xs text-red-700">Could not load advertorials: {advertorials.error}</p>}
              {advertorials.records?.length === 0 && (
                <p className="mt-1 text-xs text-neutral-500">{product.name} has no advertorials yet. Add one first.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label.Root htmlFor="image-size" className="text-sm font-medium">
                  Image size
                </Label.Root>
                <Select id="image-size" value={size} options={SIZES} onValueChange={setSize} className={field} />
              </div>
              <div>
                <Label.Root htmlFor="image-format" className="text-sm font-medium">
                  Output format
                </Label.Root>
                <Select id="image-format" value={format} options={FORMATS} onValueChange={setFormat} className={field} />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close type="button" className={button.secondary}>
                Cancel
              </Dialog.Close>
              <button type="submit" disabled={busy || !valid} className={button.primary}>
                {busy ? 'Starting…' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
