import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import { ThemeProvider } from '@/components/ThemeProvider';
import ClaudeCodeIndicator from '@/components/ClaudeCodeIndicator';

export const metadata: Metadata = {
  title: "Kemp's Life OS",
  description: 'Your personal command center',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning prevents a hydration mismatch when the inline
    // script sets data-theme before React mounts.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline script runs synchronously before first paint — prevents theme flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}`,
          }}
        />
      </head>
      <body
        className="flex h-screen overflow-hidden"
        style={{ background: 'var(--bg)', color: 'var(--text)' }}
      >
        <ThemeProvider>
          <Sidebar />
          <main
            className="flex-1 overflow-y-auto p-6 lg:p-8"
            style={{ background: 'var(--bg)' }}
          >
            {children}
          </main>
          <div style={{ position: 'fixed', bottom: 16, left: 16, zIndex: 50 }}>
            <ClaudeCodeIndicator />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
