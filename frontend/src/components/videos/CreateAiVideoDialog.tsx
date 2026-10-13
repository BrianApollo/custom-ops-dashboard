import { Dialog, Label, Progress } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import type { Product } from '../../data'
import { api } from '../../lib/api'
import { describeVideoFile, storeVideoFile, videoFileName } from '../../lib/videoUpload'
import { button, input, Select } from '../ui'
import type { Editor } from './ServerTable'

interface Props {
  product: Product
  editors: Editor[]
  onClose: () => void
  onCreated: () => void
}

// An AI video arrives finished: the file is uploaded with it and it is Available at once
export function CreateAiVideoDialog({ product, editors, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [editorId, setEditorId] = useState('')
  const [file, setFile] = useState<File>()
  const [progress, setProgress] = useState<number>()
  const [error, setError] = useState<string>()
  const busy = progress !== undefined

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return
    setError(undefined)
    setProgress(0)
    try {
      // stored as {Product}/AI-Videos/{name}.{ext}
      const fileName = videoFileName(name, file)
      const [stored, data] = await Promise.all([
        storeVideoFile({ kind: 'ai-video', productId: product.id, fileName, file, onProgress: setProgress }),
        describeVideoFile(file),
      ])
      await api('/data/ai_videos', {
        method: 'POST',
        body: {
          fields: {
            'Video Name': name.trim(),
            Status: 'Available',
            Editor: [editorId],
            Product: [product.id],
            'Creative Link': stored.publicUrl,
            'Video Data': JSON.stringify(data),
          },
        },
      })
      onCreated()
    } catch (err) {
      setError((err as Error).message)
      setProgress(undefined)
    }
  }

  return (
    // an upload in progress is not thrown away by a stray click outside
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Create AI video</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            For {product.name}. The file is uploaded now and the video is available straight away.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label.Root htmlFor="ai-video-name" className="text-sm font-medium">
                Video name
              </Label.Root>
              <input id="ai-video-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1.5`} />
            </div>
            <div>
              <Label.Root htmlFor="ai-video-editor" className="text-sm font-medium">
                Editor
              </Label.Root>
              <Select
                id="ai-video-editor"
                value={editorId}
                options={editors.map((editor) => ({ value: editor.id, label: editor.name }))}
                placeholder={editors.length ? 'Choose an editor' : 'No video editors found'}
                disabled={editors.length === 0}
                onValueChange={setEditorId}
                className="mt-1.5 w-full"
              />
            </div>
            <div>
              <Label.Root htmlFor="ai-video-file" className="text-sm font-medium">
                Video file
              </Label.Root>
              <input
                id="ai-video-file"
                type="file"
                accept="video/*"
                required
                onChange={(e) => setFile(e.target.files?.[0])}
                className="mt-1.5 block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-solid file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-800 hover:file:bg-neutral-50"
              />
            </div>
            {busy && (
              <div role="status">
                <Progress.Root value={Math.round(progress * 100)} aria-label="Upload progress" className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
                  <Progress.Indicator className="h-full rounded-full bg-blue-700 transition-[width]" style={{ width: `${progress * 100}%` }} />
                </Progress.Root>
                <p className="mt-2 text-sm text-neutral-600 tabular-nums">Uploading… {Math.round(progress * 100)}%</p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close type="button" disabled={busy} className={button.secondary}>
                Cancel
              </Dialog.Close>
              <button type="submit" disabled={busy || !name.trim() || !editorId || !file} className={button.primary}>
                {busy ? 'Creating…' : 'Create video'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
