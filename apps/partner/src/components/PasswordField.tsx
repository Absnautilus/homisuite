import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// Copied from apps/web's own components/PasswordField.tsx -- small enough
// not to be worth lifting into @homisuite/ui for its one other consumer.
export function PasswordField(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false)
  return (
    <span className="password-field">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" aria-label={show ? 'Nascondi password' : 'Mostra password'} onClick={() => setShow((value) => !value)}>
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </span>
  )
}
