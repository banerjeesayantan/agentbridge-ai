import { defineApp } from "convex/server";
import rag from "@convex-dev/rag/convex.config";
import agent from "@convex-dev/agent/convex.config";

// These mounted components are required by Agent, RAG, and the generated component registry.
const app = defineApp();

app.use(agent);
app.use(rag);

export default app;
