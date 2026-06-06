import React from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Optional additional classes to apply to the inner dialog container */
  className?: string;
  /** Optional size hint for common widths: 'sm' | 'md' | 'lg' | 'xl' */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, className = '', size }) => {
  if (!open) return null;
  // map size hint to Tailwind max-width classes
  const sizeClass = size === 'sm' ? 'max-w-sm' : size === 'md' ? 'max-w-md' : size === 'lg' ? 'max-w-4xl' : size === 'xl' ? 'max-w-6xl' : size === 'full' ? 'max-w-full' : 'max-w-lg';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${sizeClass} relative flex flex-col max-h-[90vh] ${className}`}>
        <div className="p-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 font-bold text-xl"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto scrollbar-hide p-6">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
