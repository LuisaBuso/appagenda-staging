import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="top-center"
      toastOptions={{
        style: {
          background: '#1a1a2e',
          color: '#ffffff',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px',
        },
        duration: 4000,
      }}
      {...props}
    />
  );
};

export { Toaster };
