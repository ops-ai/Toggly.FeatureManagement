import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";

import { toggly } from "@ops-ai/vue-feature-flags-toggly";

import "./assets/main.css";

const app = createApp(App);

const defaultFeatureFlags = {
  mainDescription: false,
  documentationItem: false,
  toolingItem: true,
};

app.config.globalProperties.$toggly = toggly;
app.config.globalProperties.$toggly.init(
  "<your-application-key>",
  "Production",
  "<unique-user-identifier>",
  defaultFeatureFlags
);

app.use(router);

app.mount("#app");
