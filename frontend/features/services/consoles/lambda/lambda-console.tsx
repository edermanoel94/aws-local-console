"use client";

import { ConsoleRoot } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { FunctionList } from "./function-list";
import { CreateFunctionPage } from "./create-function";
import { FunctionDetail } from "./function-detail";

function LambdaRouter() {
  const { view, resource } = useConsoleNav();
  if (view === "create") return <CreateFunctionPage />;
  if (resource) return <FunctionDetail key={resource} functionName={resource} />;
  return <FunctionList />;
}

export default function LambdaConsole() {
  return (
    <ConsoleRoot>
      <LambdaRouter />
    </ConsoleRoot>
  );
}
