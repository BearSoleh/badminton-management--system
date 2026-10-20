import { Link } from 'react-router-dom'

export function Brand() {
  return <Link to="/" className="brand" aria-label="BJBC home"><span className="brand-mark" aria-hidden="true">B</span><span>BJBC<span className="brand-detail">Badminton club</span></span></Link>
}
