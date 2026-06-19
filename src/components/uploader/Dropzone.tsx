import { useCallback, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';

type DropzoneProps = {
  onSelect: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
};

function Dropzone({ onSelect, accept, multiple = true, className }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragged, setIsDragged] = useState(false);
  const inputId = useId();
  const { t } = useTranslations<Dictionary['newEvent']>();

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const files = Array.from(fileList);
      if (files.length === 0) return;
      onSelect(files);
    },
    [onSelect],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragged(false);
      handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragged(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragged(false);
      }}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center bg-muted/10 rounded-2xl border-2 border-dashed border-muted-foreground/10 p-8 text-center transition-colors',
        'hover:bg-muted/30 focus-visible:outline focus-visible:outline-offset-2',
        isDragged && 'bg-muted/40',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={(event) => handleFiles(event.target.files)}
        id={inputId}
      />
      <div className="flex flex-col items-center justify-center gap-3">
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="focus-visible:outline focus-visible:outline-offset-2"
        >
          {t('upload')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('dragFiles')}</p>
      </div>
    </label>
  );
}

export { Dropzone };
