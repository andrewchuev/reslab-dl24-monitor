import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import Dashboard from './Dashboard.tsx';

export default function App() {
    const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark');

    return (
        <div className={themeMode === 'dark' ? 'dark' : ''}>
            <TooltipProvider>
                <div className="h-screen overflow-y-auto overflow-x-hidden bg-background p-4 text-foreground">
                    <Dashboard themeMode={themeMode} setThemeMode={setThemeMode} />
                </div>
                <Toaster richColors position="top-right" />
            </TooltipProvider>
        </div>
    );
}
