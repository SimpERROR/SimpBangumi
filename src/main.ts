import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";
import { initializeWindowState } from "./tauri/windowControls";


createApp(App).mount("#app");
void initializeWindowState();
