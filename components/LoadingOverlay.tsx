import React from 'react';

interface LoadingOverlayProps {
    isOpen: boolean;
    message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isOpen, message = "處理中，請稍候..." }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl p-6 flex flex-col items-center space-y-4 max-w-sm mx-4">
                <div className="relative w-12 h-12">
                    <div className="absolute top-0 left-0 w-full h-full border-4 border-slate-200 rounded-full"></div>
                    <div className="absolute top-0 left-0 w-full h-full border-4 border-brand-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
                <div className="text-slate-700 font-medium text-lg">{message}</div>
            </div>
        </div>
    );
};
