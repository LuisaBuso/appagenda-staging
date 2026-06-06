import * as React from 'react';

import { cn } from '../../lib/utils';
import { autoResizeTextarea } from '../../lib/textareaAutosize';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

    // Sincroniza con ref externo
    const setRefs = (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    };

    // Auto-resize en mount y cuando cambie el value
    React.useEffect(() => {
      autoResizeTextarea(innerRef.current);
    }, [props.value]);

    const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
      autoResizeTextarea(e.currentTarget);
      props.onInput?.(e);
    };

    return (
      <textarea
        className={cn(
          'flex min-h-[140px] w-full rounded-md border border-input bg-white px-3 py-3 text-sm leading-relaxed text-gray-900 shadow-inner placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-hidden',
          className
        )}
        onInput={handleInput}
        ref={setRefs}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
