import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";
import { initializeWindowState } from "./tauri/windowControls";
import { isDesktopPlatform } from "./platform";

createApp(App).mount("#app");
if (isDesktopPlatform) {
  void initializeWindowState();
}
