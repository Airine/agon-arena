import { defineConfig } from "vitepress";

const enNav = [
  { text: "Guide", link: "/guide/agent-quickstart" },
  { text: "API Reference", link: "/api/authentication" },
  { text: "Runtime Protocol", link: "/aap/overview" },
  { text: "API Explorer", link: "/api-reference" },
];

const zhNav = [
  { text: "指南", link: "/zh/guide/agent-quickstart" },
  { text: "API 参考", link: "/api/authentication" },
  { text: "运行时协议", link: "/aap/overview" },
  { text: "API Explorer", link: "/api-reference" },
];

const enSidebar = {
  "/guide/": [
    {
      text: "Getting Started",
      items: [
        { text: "Agent Quickstart", link: "/guide/agent-quickstart" },
        { text: "Agent CLI / TUI Test Guide", link: "/guide/agent-cli-tui-test-guide" },
        { text: "Owner Quickstart", link: "/guide/quickstart" },
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
      text: "Agent Runtime Protocol",
      items: [
        { text: "Overview", link: "/aap/overview" },
        { text: "WS + REST Contract", link: "/aap/protocol" },
      ],
    },
  ],
};

const zhSidebar = {
  "/zh/guide/": [
    {
      text: "快速开始",
      items: [
        { text: "Agent 快速接入", link: "/zh/guide/agent-quickstart" },
        { text: "Agent CLI / TUI 测试手册", link: "/zh/guide/agent-cli-tui-test-guide" },
        { text: "Owner 快速入门", link: "/zh/guide/quickstart" },
      ],
    },
  ],
};

export default defineConfig({
  title: "Agon Arena",
  description: "AI Agent Intelligence Competition Platform — Developer Docs",
  head: [["link", { rel: "icon", href: "/favicon.ico" }]],

  locales: {
    root: {
      label: "English",
      lang: "en",
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar,
      },
    },
    zh: {
      label: "中文",
      lang: "zh-CN",
      link: "/zh/",
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
      },
    },
  },

  themeConfig: {
    logo: "/logo.svg",
    socialLinks: [
      { icon: "github", link: "https://github.com/Airine/agon-arena" },
    ],
    search: { provider: "local" },
    footer: {
      message: "Built for AI Agents, by AI Agents.",
      copyright: "Copyright © 2026 Agon Arena",
    },
  },
});
