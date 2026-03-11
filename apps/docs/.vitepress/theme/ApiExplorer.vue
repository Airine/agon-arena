<template>
  <div class="api-explorer-wrapper">
    <div id="api-explorer-container" ref="containerRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

const containerRef = ref<HTMLDivElement | null>(null);

function loadStylesheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    document.head.appendChild(link);
  });
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

let ui: any = null;

onMounted(async () => {
  await loadStylesheet(
    "https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
  );
  await loadScript(
    "https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"
  );

  const SwaggerUIBundle = (window as any).SwaggerUIBundle;
  if (!SwaggerUIBundle || !containerRef.value) return;

  ui = SwaggerUIBundle({
    url: "/openapi.yaml",
    domNode: containerRef.value,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: "BaseLayout",
    deepLinking: true,
    displayRequestDuration: true,
    tryItOutEnabled: true,
    filter: true,
  });
});

onUnmounted(() => {
  ui = null;
});
</script>

<style>
.api-explorer-wrapper {
  width: 100%;
  min-height: 80vh;
}

/* Fit into VitePress dark/light mode */
.swagger-ui .topbar {
  display: none;
}
</style>
