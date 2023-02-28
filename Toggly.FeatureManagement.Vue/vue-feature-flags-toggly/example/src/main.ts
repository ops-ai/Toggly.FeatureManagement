import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";

import { toggly } from "@ops-ai/vue-feature-flags-toggly";

import "./assets/main.css";

const app = createApp(App);

const featureDefaults = {
  mainDescription: true,
  documentationItem: true,
  toolingItem: true,
};

app.use(toggly, {
  appKey: "your-app-key", // You can find this in Toggly.io
  environment: "your-environment-name", // You can find this in Toggly.io
  identity: "unique-user-identifier", // Use this in case you want to support custom feature rollouts
  featureDefaults: featureDefaults,
});

app.use(router);

app.mount("#app");
