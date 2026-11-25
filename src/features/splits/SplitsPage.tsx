import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { Archive, ArrowDown, ArrowUp, Copy, Layers3, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useTraining } from '../../services/training/TrainingProvider'
import { useAuth } from '../../services/auth/AuthProvider'
import { SPLIT_TEMPLATES } from '../../data/splitTemplates'
import { splitInputSchema } from '../../schemas/training'
import type { SplitInput, TrainingSplit } from '../../types/training'
import PlanNavigation from '../plan/PlanNavigation'
import { readSplitDraft, saveSplitDraft, type SplitDraft } from './draft'
import '../plan/plan.css'

type Editor = { id: string; sourceId: string | null; expectedRevision?: number; input: SplitInput }
const modes = { rolling: 'Rolling split', fixed: 'Fixed schedule', adaptive: 'Smart adaptive' }
const emptySlot = () => ({ id: crypto.randomUUID(), label: '', routineId: null, isRestDay: false })
function message(error: unknown) { return error instanceof Error ? error.message : 'This change could not be saved. Your draft is still on this device.' }

export default function SplitsPage() {
  const training = useTraining()
  const { user, account } = useAuth()
  const [editor, setEditor] = useState<Editor | null>(null)
  const [archived, setArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [draftNotice, setDraftNotice] = useState('')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{ split: TrainingSplit; archive: boolean } | null>(null)
  const draftQueue = useRef<Promise<unknown>>(Promise.resolve())
  const [dirty, setDirty] = useState(false)
  const uid = user?.uid
  const routines = training.routines.filter(item => !item.archived)
  const splits = training.splits.filter(item => item.archived === archived)
  const selectedTemplate = SPLIT_TEMPLATES.find(item => item.id === templateId)

  useEffect(() => {
    if (!uid || !editor || busy) return
    const draft: SplitDraft = { ...editor, uid, key: `${uid}:${editor.sourceId || 'new'}`, savedAt: Date.now() }
    draftQueue.current = draftQueue.current.catch(() => undefined).then(() => saveSplitDraft(draft)).catch(() => setDraftNotice('Draft storage is unavailable. Keep this editor open until you save.'))
  }, [editor, uid, busy])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function openEditor(split?: TrainingSplit, duplicate = false) {
    setError(''); setDraftNotice(''); setDirty(false)
    const draft: Editor = {
      id: split && !duplicate ? split.id : crypto.randomUUID(), sourceId: split && !duplicate ? split.id : null,
      expectedRevision: split && !duplicate ? split.revision : undefined,
      input: split ? { name: duplicate ? `${split.name} copy` : split.name, description: split.description, mode: split.mode, slots: split.slots.map(slot => ({...slot, id: duplicate ? crypto.randomUUID() : slot.id})) } : { name: '', description: '', mode: account?.preferences.schedulingMode || 'rolling', slots: [emptySlot()] },
    }
    if (uid && !duplicate) {
      try {
        const saved = await readSplitDraft(uid, split?.id || 'new')
        if (saved && saved.uid === uid && saved.savedAt > (split?.updatedAt || 0) && typeof saved.input?.name === 'string' && Array.isArray(saved.input.slots) && saved.input.slots.every(slot => typeof slot.label === 'string' && typeof slot.id === 'string' && typeof slot.isRestDay === 'boolean') && ['fixed','rolling','adaptive'].includes(saved.input.mode)) {
          setEditor(saved); setDirty(true); setDraftNotice('Your unfinished split was restored from this device.'); return
        }
      } catch { setDraftNotice('Draft recovery is unavailable on this device.') }
    }
    setEditor(draft)
  }
  function update(input: SplitInput) { if (!busy) { setEditor(value => value ? {...value, input} : value); setDirty(true) } }
  function closeEditor() { if (!busy) { setEditor(null); setDirty(false); setError('') } }
  async function save() {
    if (!editor || busyRef.current) return
    const parsed = splitInputSchema.safeParse(editor.input)
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(' ')); return }
    busyRef.current = true; setBusy(true); setError('')
    try {
      await draftQueue.current.catch(() => undefined)
      await training.saveSplit(parsed.data, {id: editor.id, expectedRevision: editor.expectedRevision})
      setDirty(false); setEditor(null)
    } catch (failure) { setError(message(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function act(operation: () => Promise<unknown>) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await operation(); setConfirmation(null); setTemplateId(null) }
    catch (failure) { setError(message(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function move(index: number, step: number) {
    if (!editor) return
    const slots = [...editor.input.slots]
    ;[slots[index], slots[index+step]] = [slots[index+step], slots[index]]
    update({...editor.input, slots})
  }

  return <div className="training-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">A rhythm you can return to</p><h1 className="page-heading">Your workout splits.</h1><p className="page-description">Put your routines in order. Leave room for rest.</p></div><button className="btn btn-primary" onClick={() => void openEditor()} disabled={busy}><Plus size={18}/> New split</button></div>
    <PlanNavigation />
    {error && !editor && <p className="notice" role="alert">{error}</p>}
    <section aria-labelledby="your-splits"><div className="section-label-row"><h2 className="section-heading" id="your-splits">Your splits</h2><label className="archive-toggle"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /> Show archived</label></div>
      {training.loading ? <p className="muted" role="status">Loading your splits…</p> : splits.length ? <div className="split-grid">{splits.map(split => <article key={split.id} className={`card split-card ${training.activeSplitId === split.id ? 'active-split' : ''}`}>
        <div className="section-label-row"><Layers3 size={23}/><span className={training.activeSplitId === split.id ? 'active-badge' : 'quiet-badge'}>{training.activeSplitId === split.id ? 'Active split' : modes[split.mode]}</span></div>
        <h3>{split.name}</h3>{split.description && <p className="muted">{split.description}</p>}<ol className="split-preview">{split.slots.map((slot,index) => {const routine=training.routines.find(item => item.id===slot.routineId);return <li key={slot.id}><span className="slot-number">{index+1}</span><div><strong>{slot.label}</strong><small>{slot.isRestDay ? 'Rest day' : routine ? `${routine.name}${routine.archived ? ' · archived' : ''}` : 'Routine unavailable'}</small></div></li>})}</ol>
        <div className="record-actions">{!split.archived && <><button className="btn btn-secondary" onClick={() => void openEditor(split)} disabled={busy}>Edit split</button><button className="btn btn-primary" onClick={() => void act(() => training.setActiveSplit(training.activeSplitId===split.id ? null : split.id))} disabled={busy}>{training.activeSplitId===split.id ? 'Deactivate' : 'Make active'}</button></>}
          <button className="icon-button" aria-label={`Duplicate ${split.name}`} disabled={busy} onClick={() => void openEditor(split,true)}><Copy size={18}/></button><button className="icon-button" aria-label={`${split.archived ? 'Restore' : 'Archive'} ${split.name}`} disabled={busy} onClick={() => {setError('');setConfirmation({split,archive:!split.archived})}}>{split.archived ? <RotateCcw size={18}/> : <Archive size={18}/>}</button>
        </div>
      </article>)}</div> : <div className="card training-empty"><Layers3 size={32}/><h3>{archived ? 'No archived splits.' : 'Give your routines a rhythm.'}</h3><p>{archived ? 'Archived splits stay here so you can restore them later.' : 'Start with a template, or arrange your own routines into a custom split.'}</p>{!archived && <button className="btn btn-secondary" onClick={() => void openEditor()}>Create a custom split</button>}</div>}
    </section>
    <section className="template-section" aria-labelledby="templates-heading"><div className="section-label-row"><h2 id="templates-heading" className="section-heading">Start with a template</h2><span className="subtle-caption">Fully editable after you add it</span></div><div className="template-grid">{SPLIT_TEMPLATES.map(template => <button key={template.id} className="template-card" onClick={() => {setError('');setTemplateId(template.id)}} disabled={busy}><Layers3 size={20}/><strong>{template.name}</strong><span>{template.description}</span><small>{template.days.length} routines · Preview template</small></button>)}</div></section>
    <p className="training-footnote">Splits define your training sequence. Calendar scheduling and adaptive recommendations come in Phase 4.</p>
    <Dialog.Root open={Boolean(editor)} onOpenChange={open => {if(!open)closeEditor()}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="split-editor-dialog"><div className="dialog-heading"><div><Dialog.Title>{editor?.sourceId ? 'Edit your split' : 'Create a split'}</Dialog.Title><Dialog.Description>Assign a routine to each training slot, or make it a rest day.</Dialog.Description></div><button className="icon-button" aria-label="Close split editor" disabled={busy} onClick={closeEditor}><X size={20}/></button></div>
      {editor && <form onSubmit={event => {event.preventDefault();void save()}}><fieldset disabled={busy} className="editor-fieldset"><div className="form-grid"><div className="field"><label htmlFor="split-name">Split name</label><input className="input" id="split-name" maxLength={80} value={editor.input.name} onChange={event => update({...editor.input,name:event.target.value})} required/></div><div className="field"><label htmlFor="split-mode">Scheduling style</label><select className="select" id="split-mode" value={editor.input.mode} onChange={event => update({...editor.input,mode:event.target.value as SplitInput['mode']})}>{Object.entries(modes).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div></div><div className="field"><label htmlFor="split-description">Description <span className="muted">(optional)</span></label><textarea className="input" id="split-description" maxLength={1000} value={editor.input.description} onChange={event => update({...editor.input,description:event.target.value})}/></div>
      {!routines.length && <p className="notice">Create a routine first, or use one of the templates outside this editor.</p>}
      <div className="split-slot-editor">{editor.input.slots.map((slot,index) => <section className="split-slot-row" key={slot.id} aria-label={`Slot ${index+1}`}><span className="slot-number">{index+1}</span><div className="slot-fields"><div className="field"><label htmlFor={`slot-label-${slot.id}`}>Slot {index+1} label</label><input className="input" id={`slot-label-${slot.id}`} maxLength={80} placeholder="e.g. Upper body" value={slot.label} onChange={event => update({...editor.input,slots:editor.input.slots.map(item => item.id===slot.id ? {...item,label:event.target.value} : item)})}/></div><label className="archive-toggle"><input type="checkbox" checked={slot.isRestDay} onChange={event => update({...editor.input,slots:editor.input.slots.map(item => item.id===slot.id ? {...item,isRestDay:event.target.checked,routineId:event.target.checked ? null : item.routineId} : item)})}/> Rest day</label>{!slot.isRestDay && <div className="field"><label htmlFor={`slot-routine-${slot.id}`}>Routine for slot {index+1}</label><select className="select" id={`slot-routine-${slot.id}`} value={slot.routineId || ''} onChange={event => update({...editor.input,slots:editor.input.slots.map(item => item.id===slot.id ? {...item,routineId:event.target.value || null} : item)})}><option value="">Choose a routine</option>{routines.map(routine => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></div>}</div><div className="slot-actions"><button type="button" className="icon-button" aria-label={`Move slot ${index+1} up`} disabled={index===0} onClick={() => move(index,-1)}><ArrowUp size={17}/></button><button type="button" className="icon-button" aria-label={`Move slot ${index+1} down`} disabled={index===editor.input.slots.length-1} onClick={() => move(index,1)}><ArrowDown size={17}/></button><button type="button" className="icon-button" aria-label={`Remove slot ${index+1}`} disabled={editor.input.slots.length===1} onClick={() => update({...editor.input,slots:editor.input.slots.filter(item => item.id!==slot.id)})}><Trash2 size={17}/></button></div></section>)}</div><button type="button" className="btn btn-secondary" disabled={editor.input.slots.length>=12} onClick={() => update({...editor.input,slots:[...editor.input.slots,emptySlot()]})}><Plus size={16}/> Add slot</button>{error && <p className="notice" role="alert">{error}</p>}<p className="subtle-caption">{draftNotice || 'An unfinished copy is saved on this device. Closing keeps your draft.'}</p><div className="editor-footer"><button type="button" className="btn btn-secondary" onClick={closeEditor}>Close</button><button className="btn btn-primary" type="submit">{busy ? 'Saving…' : 'Save split'}</button></div></fieldset></form>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={Boolean(selectedTemplate)} onOpenChange={open => {if(!open&&!busy)setTemplateId(null)}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content template-dialog"><Dialog.Title>{selectedTemplate?.name}</Dialog.Title><Dialog.Description>{selectedTemplate?.description} This adds editable starter routines and a split to your library.</Dialog.Description><ol className="template-day-list">{selectedTemplate?.days.map(day => <li key={day.label}><strong>{day.label}</strong><span>{day.exerciseIds.map(id => training.exercises.find(exercise => exercise.id===id)?.name || id).join(' · ')}</span></li>)}</ol>{error && <p className="notice" role="alert">{error}</p>}<div className="record-actions"><button className="btn btn-secondary" onClick={() => setTemplateId(null)} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={() => selectedTemplate && void act(() => training.createSplitFromTemplate(selectedTemplate.id))} disabled={busy}>{busy ? 'Adding…' : 'Add template'}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={Boolean(confirmation)} onOpenChange={open => {if(!open&&!busy)setConfirmation(null)}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{confirmation?.archive ? 'Archive this split?' : 'Restore this split?'}</Dialog.Title><Dialog.Description>{confirmation?.archive ? 'The split stays in your archive. Its routines are preserved. An active split will be deactivated.' : 'This split will return to your library. You can make it active when you are ready.'}</Dialog.Description>{error && <p className="notice" role="alert">{error}</p>}<div className="record-actions"><button className="btn btn-secondary" onClick={() => setConfirmation(null)} disabled={busy}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => confirmation && void act(() => training.archiveSplit(confirmation.split.id,confirmation.archive,confirmation.split.revision))}>{busy ? 'Saving…' : confirmation?.archive ? 'Archive split' : 'Restore split'}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Link className="text-link" to="/plan/routines">Manage your routines</Link>
  </div>
}
