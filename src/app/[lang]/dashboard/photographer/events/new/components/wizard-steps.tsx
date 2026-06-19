'use client';

import { Check } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';

type NewEventT = Dictionary['newEvent'];

export type StepNumber = 1 | 2 | 3 | 4;

type WizardStepsProps = {
  current: StepNumber;
  // Highest step the user has reached. Steps with `index <= reached` are
  // tappable (navigates back); future steps are aria-disabled.
  reached: StepNumber;
  onSelect: (step: StepNumber) => void;
};

export function WizardSteps({ current, reached, onSelect }: WizardStepsProps) {
  const { t } = useTranslations<NewEventT>();
  // Only steps 1-3 appear in the indicator. Step 4 (review) is the natural
  // next view after step 3 and is not counted as a "step" for the user.
  const steps: Array<{ id: StepNumber; label: string }> = [
    { id: 1, label: t('step1Title') },
    { id: 2, label: t('step2Title') },
    { id: 3, label: t('step3Title') },
  ];

  return (
    <nav aria-label={t('wizardStepsAria')} className="w-full">
      {/* Steps and connectors live in the same flex row. Steps are content-sized;
          connectors take flex-1 so the whole row always spans the available
          width regardless of label length. */}
      <ol className="flex w-full items-center gap-2 sm:gap-3">
        {steps.map((step, idx) => {
          const isCompleted = step.id < current || current === 4;
          const isCurrent = step.id === current;
          const isReachable = step.id <= reached;
          const isLast = idx === steps.length - 1;

          return (
            <li key={step.id} className="contents">
              <button
                type="button"
                onClick={() => isReachable && step.id !== current && onSelect(step.id)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-disabled={!isReachable}
                className={cn(
                  'group flex shrink-0 items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors',
                  !isReachable && 'cursor-not-allowed opacity-60',
                  isReachable && !isCurrent && 'hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                    isCurrent && 'bg-primary text-primary-foreground',
                    isCompleted && 'bg-primary/15 text-primary',
                    !isCurrent && !isCompleted && 'bg-muted text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {isCompleted ? <Check className="h-3.5 w-3.5" /> : step.id}
                </span>
                <span
                  className={cn(
                    'hidden truncate text-sm sm:inline',
                    isCurrent && 'font-medium text-foreground',
                    !isCurrent && 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              </button>
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    'h-px flex-1 transition-colors',
                    isCompleted ? 'bg-primary/40' : 'bg-border',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
