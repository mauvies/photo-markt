'use client';

/**
 * The art. 16(m) consent checkbox shown above every "Proceed to checkout"
 * button (T-228).
 *
 * One sentence carrying BOTH statements the exemption requires: the express
 * request to begin delivery immediately, and the acknowledgement that this
 * loses the right of withdrawal. They are deliberately not split into two
 * boxes — a consumer who ticks one and not the other has consented to nothing
 * usable, so two boxes only add a way to get a half-answer.
 *
 * Purely presentational: the parent owns the state and the server re-checks it
 * (`consent_required`). Ticking this box is never what authorizes the charge.
 *
 * `id` is required and must be unique per render site: both cart layouts render
 * the summary twice (desktop panel + mobile sticky footer) and both copies are
 * in the DOM at once, so a shared id would point every label at one input.
 */
export function WithdrawalConsentCheckbox({
  id,
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
      />
      <label htmlFor={id} className="cursor-pointer text-xs leading-relaxed text-muted-foreground">
        {label}
      </label>
    </div>
  );
}
