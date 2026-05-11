import { createFileRoute, redirect } from "@tanstack/react-router";

// Rota legada: substituída pelo novo modelo de Automações.
export const Route = createFileRoute("/_authenticated/settings_/rules")({
  beforeLoad: () => {
    throw redirect({ to: "/automations" });
  },
});
