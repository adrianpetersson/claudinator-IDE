import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';

export function ToastContainer() {
  useEffect(() => {
    return window.electronAPI.onToast((data) => {
      if (data.url) {
        toast(data.message, {
          action: {
            label: 'Open',
            onClick: () => window.electronAPI.openExternal(data.url!),
          },
          duration: 6000,
        });
      } else {
        toast(data.message, { duration: 6000 });
      }
    });
  }, []);

  return <Toaster theme="system" position="bottom-right" />;
}
