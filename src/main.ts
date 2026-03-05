import "./styles/themes.css";
import "./styles/base.css";
import "./styles/settings.css";
import "./styles/popup.css";
import App from "./App.svelte";
import { mount } from "svelte";

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
