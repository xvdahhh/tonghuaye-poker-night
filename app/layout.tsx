import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '同花夜 · 好友德州扑克',
  description: '创建私人牌桌，邀请好友跨设备联网对战。无需下载，打开链接就开局。',
  openGraph: {
    title: '同花夜 · 把朋友叫上桌',
    description: '私人德州牌桌，2—6 位好友跨设备联网开局。',
    type: 'website',
    locale: 'zh_CN',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: '同花夜 · 把朋友叫上桌' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '同花夜 · 把朋友叫上桌',
    description: '私人德州牌桌，2—6 位好友跨设备联网开局。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

