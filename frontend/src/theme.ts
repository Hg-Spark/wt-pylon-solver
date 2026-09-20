import {definePreset} from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";

export const WtPylonSolverPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "{teal.50}",
      100: "{teal.100}",
      200: "{teal.200}",
      300: "{teal.300}",
      400: "{teal.400}",
      500: "{teal.500}",
      600: "{teal.600}",
      700: "{teal.700}",
      800: "{teal.800}",
      900: "{teal.900}",
      950: "{teal.950}",
    },
    focusRing: {
      width: "2px",
      style: "solid",
      color: "{primary.color}",
      offset: "2px",
    },
    colorScheme: {
      light: {
        primary: {
          color: "{primary.700}",
          inverseColor: "#ffffff",
          hoverColor: "{primary.800}",
          activeColor: "{primary.900}",
        },
        surface: {
          0: "#ffffff",
          50: "#f7fafb",
          100: "#eef3f4",
          200: "#d9e5e7",
          300: "#c2d3d6",
          400: "#91a7ad",
          500: "#6a7e84",
          600: "#4e646a",
          700: "#344a51",
          800: "#22363c",
          900: "#14252b",
          950: "#0a171b",
        },
        highlight: {
          background: "{primary.50}",
          focusBackground: "{primary.100}",
          color: "{primary.800}",
          focusColor: "{primary.900}",
        },
      },
    },
  },
});
