import {createApp} from "vue";
import {createPinia} from "pinia";
import PrimeVue from "primevue/config";
import App from "./App.vue";
import {WtPylonSolverPreset} from "./theme";
import "./styles.css";

createApp(App)
  .use(createPinia())
  .use(PrimeVue, {
    theme: {
      preset: WtPylonSolverPreset,
      options: {
        darkModeSelector: false,
      },
    },
  })
  .mount("#app");
