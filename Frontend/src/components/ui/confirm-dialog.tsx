import { useState, useCallback, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './alert-dialog';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
}

type ConfirmResolver = (value: boolean) => void;

let globalSetConfirm: ((opts: ConfirmOptions & { resolve: ConfirmResolver }) => void) | null = null;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (globalSetConfirm) {
      globalSetConfirm({ ...options, resolve });
    } else {
      resolve(false);
    }
  });
}

export function ConfirmDialogProvider() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: ConfirmResolver }) | null>(null);

  useEffect(() => {
    globalSetConfirm = (opts) => setState(opts);
    return () => { globalSetConfirm = null; };
  }, []);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  return (
    <AlertDialog open={!!state} onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <AlertDialogContent className="bg-white border border-gray-200 text-black sm:rounded-xl shadow-xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-black text-lg font-semibold">
            {state?.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-gray-600 text-sm">
            {state?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={handleCancel}
            className="bg-white border border-gray-300 text-black hover:bg-gray-100"
          >
            {state?.cancelLabel || 'Cancelar'}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-black text-white hover:bg-gray-800 border-0"
          >
            {state?.confirmLabel || 'Confirmar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
