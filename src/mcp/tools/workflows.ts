import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { NotomateClient } from "../../notomate-client.js";
import { type DefaultContext, resolveWorkspaceId, textResult } from "../context.js";

export function createWorkflowTools(client: NotomateClient, ctx: DefaultContext) {
  return [
    tool(
      "list_workflows",
      "List workflows defined in a workspace.",
      { workspaceId: z.string().optional() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(await client.listWorkflows(workspaceId));
      },
    ),

    tool(
      "get_workflow",
      "Get a single workflow's definition and metadata.",
      { workspaceId: z.string().optional(), workflowId: z.string() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(await client.getWorkflow(workspaceId, args.workflowId));
      },
    ),

    tool(
      "create_workflow",
      "Create a new workflow from a GitHub-Actions-style YAML definition.",
      { workspaceId: z.string().optional(), name: z.string(), definition: z.string() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.createWorkflow(workspaceId, {
          name: args.name,
          definition: args.definition,
        });
        return textResult(result);
      },
    ),

    tool(
      "update_workflow",
      "Update a workflow's name and/or YAML definition.",
      {
        workspaceId: z.string().optional(),
        workflowId: z.string(),
        name: z.string().optional(),
        definition: z.string().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.updateWorkflow(workspaceId, args.workflowId, {
          name: args.name,
          definition: args.definition,
        });
        return textResult(result);
      },
    ),

    tool(
      "delete_workflow",
      "Delete a workflow. This is irreversible.",
      { workspaceId: z.string().optional(), workflowId: z.string() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        await client.deleteWorkflow(workspaceId, args.workflowId);
        return textResult(`Deleted workflow ${args.workflowId}`);
      },
    ),

    tool(
      "set_workflow_enabled",
      "Enable or disable a workflow.",
      { workspaceId: z.string().optional(), workflowId: z.string(), enabled: z.boolean() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        await client.setWorkflowEnabled(workspaceId, args.workflowId, args.enabled);
        return textResult(`Set enabled=${args.enabled} on workflow ${args.workflowId}`);
      },
    ),

    tool(
      "dispatch_workflow",
      "Manually trigger a workflow_dispatch run, optionally with typed inputs.",
      {
        workspaceId: z.string().optional(),
        workflowId: z.string(),
        inputs: z.record(z.string(), z.string()).optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.dispatchWorkflow(workspaceId, args.workflowId, args.inputs);
        return textResult(result);
      },
    ),

    tool(
      "list_workflow_runs",
      "List past runs of a workflow, paginated.",
      {
        workspaceId: z.string().optional(),
        workflowId: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(
          await client.listWorkflowRuns(workspaceId, args.workflowId, args.page, args.pageSize),
        );
      },
    ),

    tool(
      "get_workflow_run",
      "Get a single workflow run, including its jobs and their statuses.",
      { workspaceId: z.string().optional(), runId: z.string() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(await client.getWorkflowRun(workspaceId, args.runId));
      },
    ),

    tool(
      "get_workflow_job_logs",
      "Get log lines for a workflow job, optionally incrementally after a given line number.",
      {
        workspaceId: z.string().optional(),
        runId: z.string(),
        jobId: z.string(),
        after: z.number().int().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(
          await client.getWorkflowJobLogs(workspaceId, args.runId, args.jobId, args.after),
        );
      },
    ),

    tool(
      "cancel_workflow_run",
      "Cancel a running or queued workflow run.",
      { workspaceId: z.string().optional(), runId: z.string() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        await client.cancelWorkflowRun(workspaceId, args.runId);
        return textResult(`Cancelled run ${args.runId}`);
      },
    ),

    tool(
      "list_workflow_vars",
      "List workspace-level workflow variables (non-secret, shared across all workflow jobs).",
      { workspaceId: z.string().optional() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(await client.listWorkflowVars(workspaceId));
      },
    ),

    tool(
      "create_workflow_var",
      "Create a workspace-level workflow variable.",
      {
        workspaceId: z.string().optional(),
        key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        value: z.string(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.createWorkflowVar(workspaceId, args.key, args.value);
        return textResult(result);
      },
    ),

    tool(
      "update_workflow_var",
      "Update the value of an existing workflow variable.",
      { workspaceId: z.string().optional(), key: z.string(), value: z.string() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.updateWorkflowVar(workspaceId, args.key, args.value);
        return textResult(result);
      },
    ),

    tool(
      "delete_workflow_var",
      "Delete a workflow variable.",
      { workspaceId: z.string().optional(), key: z.string() },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        await client.deleteWorkflowVar(workspaceId, args.key);
        return textResult(`Deleted workflow var ${args.key}`);
      },
    ),
  ];
}
