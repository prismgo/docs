import Link from 'next/link';
import Image from 'next/image';
import { HomeLayout } from 'fumadocs-ui/layouts/home';

const badges = [
  {
    label: 'Go 1.25+',
    href: 'https://go.dev/',
    color: 'bg-sky-500',
    icon: 'go',
  },
  {
    label: 'module github.com/prismgo/framework',
    href: 'https://github.com/prismgo/framework',
    color: 'bg-blue-500',
  },
  {
    label: 'Coverage',
    href: 'https://codecov.io/gh/prismgo/framework/branch/main',
    color: 'bg-green-500',
  },
  {
    label: 'v0.1.0',
    href: 'https://pkg.go.dev/github.com/prismgo/framework?tab=versions',
    color: 'bg-amber-500',
  },
  {
    label: 'MIT License',
    href: './LICENSE',
    color: 'bg-zinc-500',
  },
];

export default function HomePage() {
  return (
    <HomeLayout
      nav={{
        title: 'PrismGo Docs',
        url: '/',
      }}
      links={[
        {
          text: 'Documentation',
          url: '/zh-CN/starter',
        },
      ]}
    >
      <main className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4 py-16">
        <div className="max-w-4xl mx-auto text-center space-y-10">
          {/* Logo */}
          <div className="flex justify-center">
            <div className="relative w-[250px] h-[80px]">
              <Image
                src="/docs/logo.png"
                alt="PrismGo"
                width={250}
                height={80}
                className="object-contain"
                priority
              />
            </div>
          </div>

          {/* Headline */}
          <div className="space-y-3">
            <p className="text-xl sm:text-2xl text-muted-foreground font-medium">
              <span className="hidden sm:inline">—— </span>
              像写 Laravel 一样写 Go
              <span className="hidden sm:inline"> ——</span>
            </p>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap justify-center gap-2">
            <a
              href="https://go.dev/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3.5 py-1.5 text-sm font-medium text-sky-600 dark:text-sky-400 ring-1 ring-inset ring-sky-500/20 transition-colors hover:bg-sky-500/20"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M1.25 12.08c-.1 2.06.55 3.94 1.72 5.34a6.63 6.63 0 0 0 4.8 2.34c1.78.08 3.16-.38 4.47-1.3.63-.44 1.15-.94 1.73-1.38.42-.32.9-.55 1.38-.74a6.42 6.42 0 0 1 4.47-.27c1.47.47 2.44 1.53 3.06 2.9.6 1.4.71 2.86.18 4.3-.68 1.78-2.07 2.98-3.84 3.54-1.65.52-3.3.48-4.87-.24-1.08-.5-1.96-1.24-2.77-2.08-.4-.41-.63-.5-.99-.17-.43.4-.84.83-1.2 1.3-.24.32-.18.57.12.83.7.62 1.4 1.24 2.16 1.78 1.6 1.14 3.4 1.7 5.37 1.66 2.38-.05 4.45-.96 6.06-2.74 1.5-1.64 2.2-3.64 2.07-5.86-.13-2.28-1.15-4.16-2.74-5.67-1.55-1.47-3.45-2.23-5.57-2.24-2.06 0-3.96.68-5.7 1.8-.7.44-1.32.98-2.02 1.46-.54.37-1.13.53-1.78.48-1.1-.08-2.16-.4-3.06-1.1-.69-.54-1.18-1.24-1.48-2.08-.37-1.06-.37-2.16.04-3.2.24-.61.6-1.16 1.06-1.64.62-.65 1.33-1.17 2.12-1.57 1.86-.96 3.87-1.27 5.98-.93.54.09.8-.12.86-.67.04-.46.1-.92.18-1.37.12-.7-.08-1.1-.8-1.27a10.6 10.6 0 0 0-3.24-.18c-1.7.16-3.26.7-4.66 1.62A7.24 7.24 0 0 0 1.25 12.08Z" />
              </svg>
              Go 1.25+
            </a>
            <a
              href="https://github.com/prismgo/framework"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3.5 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20 transition-colors hover:bg-blue-500/20"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              module
            </a>
            <a
              href="https://codecov.io/gh/prismgo/framework/branch/main"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3.5 py-1.5 text-sm font-medium text-green-600 dark:text-green-400 ring-1 ring-inset ring-green-500/20 transition-colors hover:bg-green-500/20"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              Coverage
            </a>
            <a
              href="https://pkg.go.dev/github.com/prismgo/framework?tab=versions"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3.5 py-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20 transition-colors hover:bg-amber-500/20"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
              Latest
            </a>
            <a
              href="./LICENSE"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/10 px-3.5 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 ring-1 ring-inset ring-zinc-500/20 transition-colors hover:bg-zinc-500/20"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              MIT License
            </a>
          </div>

          {/* Description */}
          <div className="prose prose-zinc dark:prose-invert max-w-3xl mx-auto text-left">
            <p className="text-base leading-relaxed text-muted-foreground">
              PrismGo 是一个由 AI Agent 全自动开发的{' '}
              <strong className="font-semibold text-foreground">
                Laravel 风格的 Go 语言 Web 框架
              </strong>
              ，Laravel 设计哲学贯穿始终，与 Go 社区主流编码风格自然融合。如果你熟悉 Laravel
              的开发体验——Facade、ServiceProvider、Artisan 命令、缓存系统、Eloquent ORM
              风格、事件系统、队列任务、日志系统——那么你会在 PrismGo 里找到一模一样的感觉。
            </p>
            <p className="text-base leading-relaxed text-muted-foreground mt-4">
              我们希望让 Go 开发者不必在 &ldquo;高性能&rdquo; 和 &ldquo;高开发效率&rdquo;
              之间做选择。PrismGo 使用 Go 生态中最成熟的底层组件（
              <a href="https://github.com/gin-gonic/gin" target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 decoration-blue-500/30">Gin</a>、
              <a href="https://github.com/go-gorm/gorm" target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 decoration-blue-500/30">GORM</a>、
              <a href="https://github.com/redis/go-redis" target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 decoration-blue-500/30">Redis</a>、
              <a href="https://github.com/spf13/viper" target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 decoration-blue-500/30">Viper</a>、
              <a href="https://github.com/sirupsen/logrus" target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 decoration-blue-500/30">Logrus</a>、
              <a href="https://github.com/spf13/cobra" target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 decoration-blue-500/30">Cobra</a>
              ），再用 Laravel 的设计哲学把它们组织成一整套开箱即用的 Web 工具箱。
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Link
              href="/zh-CN/starter"
              className="inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all h-11 px-8 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25 hover:shadow-primary/30"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              快速开始
            </Link>
            <Link
              href="/en/starter"
              className="inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all h-11 px-8 border border-input bg-background hover:bg-accent hover:text-accent-foreground"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Getting Started
            </Link>
          </div>
        </div>
      </main>
    </HomeLayout>
  );
}
