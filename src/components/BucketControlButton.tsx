type BucketControlButtonProps = {
  amount: string
  ariaLabel: string
  className?: string
  detail?: string
  disabled?: boolean
  label?: string
  onClick?: () => void
  summary: string
}

export const BucketControlButton = ({
  amount,
  ariaLabel,
  className,
  detail,
  disabled = false,
  label,
  onClick,
  summary,
}: BucketControlButtonProps) => (
  <button
    aria-label={ariaLabel}
    className={'bucket-control-button' + (className ? ' ' + className : '')}
    disabled={disabled}
    onClick={onClick}
    type="button"
  >
    {label ? <span className="bucket-control-label">{label}</span> : null}
    <strong>{amount}</strong>
    <small className="bucket-control-summary">{summary}</small>
    {detail ? <small className="bucket-control-detail">{detail}</small> : null}
  </button>
)
