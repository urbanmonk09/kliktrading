// src/components/NotificationToast.tsx
"use client";
import React, { useEffect } from "react";

export default function NotificationToast({
  message,
  bg = "bg-blue-600",
  onClose,
}: {
  message: string;
  bg?: string;
  onClose?: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onClose && onClose(), 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed right-4 top-4 z-50 ${bg} text-white px-4 py-2 rounded shadow-lg`}>
      {message}
    </div>
  );
}
