import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Modal } from '@homisuite/ui'

type GuestQrModalProps = {
  open: boolean
  onClose: () => void
  hotelName: string
  link: string
}

export function GuestQrModal({ open, onClose, hotelName, link }: GuestQrModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setQrDataUrl(null)
    QRCode.toDataURL(link, { width: 480, margin: 1, color: { dark: '#16182b', light: '#ffffff' } })
      .then((dataUrl) => { if (!cancelled) setQrDataUrl(dataUrl) })
      .catch(() => { if (!cancelled) setQrDataUrl(null) })
    return () => { cancelled = true }
  }, [open, link])

  function onDownload() {
    if (!qrDataUrl) return
    const anchor = document.createElement('a')
    anchor.href = qrDataUrl
    anchor.download = `qr-${slugify(hotelName)}.png`
    anchor.click()
  }

  function onPrint() {
    if (!qrDataUrl) return
    const printWindow = window.open('', '_blank', 'width=480,height=640')
    if (!printWindow) return
    const printDocument = printWindow.document
    printDocument.title = hotelName
    const style = printDocument.createElement('style')
    style.textContent = 'body { font-family: sans-serif; text-align: center; padding: 40px; margin: 0; } img { width: 320px; height: 320px; } h1 { font-size: 18px; margin: 0 0 20px; }'
    printDocument.head.appendChild(style)
    const heading = printDocument.createElement('h1')
    heading.textContent = hotelName
    const img = printDocument.createElement('img')
    img.alt = hotelName
    img.onload = () => printWindow.print()
    img.src = qrDataUrl
    printDocument.body.append(heading, img)
    printWindow.focus()
  }

  return (
    <Modal
      open={open}
      title={hotelName}
      description="QR per l'accesso ospiti"
      onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" type="button" onClick={onDownload} disabled={!qrDataUrl}>Scarica PNG</button>
        <button className="btn btn-primary" type="button" onClick={onPrint} disabled={!qrDataUrl}>Stampa</button>
      </>}
    >
      <div className="guest-qr-preview">
        {qrDataUrl ? <img src={qrDataUrl} alt={`QR di accesso per ${hotelName}`} width={220} height={220} /> : <div className="guest-qr-placeholder" aria-hidden="true" />}
        <code>{link}</code>
      </div>
    </Modal>
  )
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'hotel'
}
