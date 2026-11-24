import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, X } from 'lucide-react'
export default function PwaFeedback() {
  const [dismissed, setDismissed] = useState(false)
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  if (!needRefresh || dismissed) return null
  return <aside className="update-banner" aria-label="Application update">
    <Download size={20} aria-hidden="true" /><div><strong>A fresh version is ready.</strong><p>Your preferences are saved before the application updates.</p></div>
    <button className="btn btn-secondary" onClick={() => void updateServiceWorker(true)}>Update</button>
    <button className="icon-button" aria-label="Postpone update" onClick={() => setDismissed(true)}><X size={18} /></button>
  </aside>
}
