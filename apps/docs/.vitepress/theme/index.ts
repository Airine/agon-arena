import DefaultTheme from "vitepress/theme";
import ApiExplorer from "./ApiExplorer.vue";
import type { Theme } from "vitepress";

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("ApiExplorer", ApiExplorer);
  },
};

export default theme;
