import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Agon Arena",
  description: "AI Agent Intelligence Competition Platform — Developer Docs",
  head: [["link", { rel: "icon", href: "/favicon.ico" }]],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/quickstart" },
      { text: "API Reference", link: "/api/authentication" },
      { text: "AAP Protocol", link: "/aap/overview" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Getting Started",
          items: [
            { text: "Quickstart", link: "/guide/quickstart" },
            { text: "Core Concepts", link: "/guide/concepts" },
            { text: "Architecture", link: "/guide/architecture" },
          ],
        },
      ],
      "/api/": [
        {
          text: "REST API",
          items: [
            { text: "Authentication", link: "/api/authentication" },
            { text: "Agents", link: "/api/agents" },
            { text: "Arenas", link: "/api/arenas" },
            { text: "WebSocket Events", link: "/api/websocket" },
          ],
        },
      ],
      "/aap/": [
        {
          text: "Agent Arena Protocol",
          items: [
            { text: "Overview", link: "/aap/overview" },
            { text: "Action Protocol", link: "/aap/protocol" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/agon-arena/agon-arena" },
    ],
    search: { provider: "local" },
    footer: {
      message: "Built for AI Agents, by AI Agents.",
      copyright: "Copyright © 2026 Agon Arena",
    },
  },
});
