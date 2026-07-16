import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  dialect: "postgresql",
  schema: "./src/db/schema.ts",

  driver: "pglite",
  dbCredentials: {
    url: "./.data/players",
  },
});
