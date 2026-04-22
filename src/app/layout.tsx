import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: '통합알람감시체계',
  description: '레이더/관제송신소 원격감시 대시보드',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko" className="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "(function(){try{if(location.pathname.indexOf('/tv')===0)return;var ua=navigator.userAgent||'';var isTv=/Web0S|webOS|SmartTV|NetCast/i.test(ua);var w=((screen&&screen.width)||0)*(window.devicePixelRatio||1);var f=location.search.indexOf('tv=1')!==-1;if(isTv||w>1920||f){location.replace('/tv/index.html');}}catch(e){}})();",
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
