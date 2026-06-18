import { defineConfig } from "deepsec/config";

export default defineConfig({
  projects: [
    { id: "tockdocs", root: ".." },
    // <deepsec:projects-insert-above>
  ],
});
