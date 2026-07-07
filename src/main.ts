import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";
import { initializeWindowState } from "./tauri/windowControls";
import { useAppStore, type ThemeMode } from "./stores/app";
import { installDiagnosticsErrorListeners } from "./composables/useDiagnostics";

const THEME_KEY = "bangumi.theme";

function resolveInitialTheme(): ThemeMode {
	const savedTheme = localStorage.getItem(THEME_KEY);
	if (savedTheme === "light" || savedTheme === "dark") {
		return savedTheme;
	}

	return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyInitialTheme() {
	const theme = resolveInitialTheme();
	const appStore = useAppStore();

	appStore.theme.value = theme;
	document.documentElement.dataset.theme = theme;
	document.documentElement.style.colorScheme = theme;
}

applyInitialTheme();
installDiagnosticsErrorListeners();

createApp(App).mount("#app");
document.documentElement.classList.remove("app-booting");
void initializeWindowState();
