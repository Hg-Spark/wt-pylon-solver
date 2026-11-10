import {createApp} from "vue";
import {createPinia} from "pinia";
import PrimeVue from "primevue/config";
import App from "./App.vue";
import {WtPylonSolverPreset} from "./theme";
import {readRecentAircraft} from "./domain/aircraft";
import "./styles.css";

readRecentAircraft();

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
