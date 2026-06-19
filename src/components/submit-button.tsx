'use client';

import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from './ui/button';
import { Spinner } from './ui/spinner';

export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending, action } = useFormStatus();

  const isPending = pending && action === props.formAction;

  return (
    <Button {...props} type="submit" aria-disabled={pending} disabled={pending}>
      {isPending ? <Spinner /> : children}
    </Button>
  );
}
