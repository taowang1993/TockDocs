export default defineAppConfig({
  header: {
    title: 'TockDocs',
    logo: {
      light: '/logo/logo-dark.svg',
      dark: '/logo/logo-light.svg',
      alt: 'TockDocs Logo',
      favicon: '/favicon.svg',
    },
  },
  socials: {
    x: 'https://x.com/nuxt_js',
    discord: 'https://discord.com/invite/ps2h6QT',
    nuxt: 'https://nuxt.com',
  },
  github: {
    rootDir: 'docs',
  },
  ui: {
    pageHero: {
      slots: {
        title: 'font-semibold sm:text-6xl',
        container: '!pb-0',
      },
    },
    pageCard: {
      slots: {
        container: 'relative lg:flex min-w-0',
        wrapper: 'flex min-w-0 flex-1 flex-col items-start',
      },
    },
    contentToc: {
      defaultVariants: {
        highlightVariant: 'circuit',
      },
    },
  },
})
