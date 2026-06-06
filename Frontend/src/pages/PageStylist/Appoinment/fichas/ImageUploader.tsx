// src/components/fichas/ImageUploader.tsx
"use client";

import { useState, useRef } from 'react';
import { Upload, X, Camera, Eye } from 'lucide-react';

interface ImageUploaderProps {
  title: string;
  images: File[];
  onImagesChange: (files: File[]) => void;
  maxImages?: number;
  accept?: string;
}

export function ImageUploader({ 
  title, 
  images, 
  onImagesChange, 
  maxImages = 5,
  accept = 'image/*' 
}: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    // Filtrar solo imágenes
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    // Limitar el número máximo de imágenes
    const remainingSlots = maxImages - images.length;
    const filesToAdd = imageFiles.slice(0, remainingSlots);
    
    if (filesToAdd.length > 0) {
      onImagesChange([...images, ...filesToAdd]);
    }
    
    // Limpiar el input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onImagesChange(newImages);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const remainingSlots = maxImages - images.length;
    const filesToAdd = imageFiles.slice(0, remainingSlots);
    
    if (filesToAdd.length > 0) {
      onImagesChange([...images, ...filesToAdd]);
    }
  };

  const openPreview = (index: number) => {
    setPreviewIndex(index);
  };

  const closePreview = () => {
    setPreviewIndex(null);
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">{title}</h3>
      
      <div
        className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          images.length >= maxImages 
            ? 'border-gray-300 bg-gray-50 cursor-not-allowed' 
            : 'border-gray-300 hover:border-gray-500 bg-gray-50 hover:bg-gray-50 cursor-pointer'
        }`}
        onClick={() => images.length < maxImages && fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          onChange={handleFileSelect}
          className="hidden"
          disabled={images.length >= maxImages}
        />
        
        <div className="flex flex-col items-center space-y-3">
          <Camera className="h-12 w-12 text-gray-400" />
          <div>
            <p className="font-medium">
              {images.length >= maxImages 
                ? 'Límite alcanzado' 
                : 'Haz clic o arrastra imágenes aquí'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {images.length >= maxImages 
                ? `Máximo ${maxImages} imágenes`
                : `Máximo ${maxImages} imágenes (${images.length}/${maxImages})`}
            </p>
          </div>
          {images.length < maxImages && (
            <button
              type="button"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-gray-600 hover:bg-gray-700"
            >
              <Upload className="h-4 w-4 mr-2" />
              Seleccionar imágenes
            </button>
          )}
        </div>
      </div>

      {/* Previsualización de imágenes */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {images.map((image, index) => (
            <div key={index} className="relative group">
              <div className="aspect-square rounded-lg overflow-hidden border bg-gray-100">
                <img
                  src={URL.createObjectURL(image)}
                  alt={`${title} ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                
                {/* Overlay con acciones */}
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPreview(index);
                      }}
                      className="p-2 bg-white rounded-full hover:bg-gray-100"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveImage(index);
                      }}
                      className="p-2 bg-white rounded-full hover:bg-gray-100"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-center mt-1 truncate">{image.name}</p>
            </div>
          ))}
        </div>
      )}

      {/* Modal de vista previa */}
      {previewIndex !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4">
          <div className="relative max-w-4xl max-h-[90vh]">
            <button
              onClick={closePreview}
              className="absolute -top-10 right-0 text-white hover:text-gray-300"
            >
              <X className="h-6 w-6" />
            </button>
            <img
              src={URL.createObjectURL(images[previewIndex])}
              alt={`Vista previa ${previewIndex + 1}`}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            <div className="absolute bottom-4 left-0 right-0 text-center text-white">
              <p className="text-sm">{images[previewIndex].name}</p>
              <p className="text-xs text-gray-300">
                Tamaño: {(images[previewIndex].size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}