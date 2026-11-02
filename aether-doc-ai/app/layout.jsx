import './globals.css';

export const metadata = {
  title: {
    default: 'Aether Doc AI — 긴 PDF, 읽기 전에 먼저 물어보세요',
    template: '%s · Aether Doc AI',
  },
  description:
    'PDF를 올리면 요약·목차·키워드가 바로 정리되고, 질문하면 근거가 된 페이지를 형광펜으로 짚어 주는 AI 문서 리더.',
  applicationName: 'Aether Doc AI',
  openGraph: {
    title: 'Aether Doc AI — 긴 PDF, 읽기 전에 먼저 물어보세요',
    description: '요약·목차·키워드를 한눈에, 답변마다 출처 페이지까지.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Aether Doc AI' }],
    type: 'website',
    locale: 'ko_KR',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Aether Doc AI',
    description: '요약·목차·키워드를 한눈에, 답변마다 출처 페이지까지.',
    images: ['/og.png'],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8ff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1424' },
  ],
};

// 첫 페인트 전에 테마를 적용해 깜빡임을 막는다
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,300..600,0..1,0&display=block"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
