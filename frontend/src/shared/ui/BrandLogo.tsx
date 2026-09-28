type BrandLogoProps = {
  className?: string
}

/** Display the complete brand image without cropping. */
export function BrandLogo({ className = '' }: BrandLogoProps) {
  return (
    <img
      className={`brand-logo ${className}`}
      src="/assets/logo.png"
      width="457"
      height="457"
      alt="잇다 Itda"
    />
  )
}
