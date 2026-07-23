export class NotomateApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string,
  ) {
    super(`notomate API ${method} ${path} failed with ${status}: ${body}`);
    this.name = "NotomateApiError";
  }
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  markdown?: boolean;
}

/**
 * Thin fetch() wrapper over the notomate REST API. Bearer-key auth is valid
 * for everything under /workspaces/** (confirmed against notomate's
 * ParseJWT() middleware), which covers the entire curated tool surface here.
 */
export class NotomateClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(
      `/api/v1${path}`,
      this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`,
    );
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (options.markdown) {
      headers["X-Content-Format"] = "markdown";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new NotomateApiError(response.status, text, method, path);
    }
    return text.length > 0 ? (JSON.parse(text) as T) : (undefined as T);
  }

  // ---- Notes ----

  listNotes(workspaceId: string, params: Record<string, string | number | boolean | undefined> = {}) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/notes`, { query: params });
  }

  getNote(workspaceId: string, noteId: string) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/notes/${noteId}`);
  }

  createNote(
    workspaceId: string,
    body: { title: string; content: string; parentId?: string; visibility?: string },
  ) {
    return this.request<unknown>("POST", `/workspaces/${workspaceId}/notes`, {
      body,
      markdown: true,
    });
  }

  deleteNote(workspaceId: string, noteId: string) {
    return this.request<unknown>("DELETE", `/workspaces/${workspaceId}/notes/${noteId}`);
  }

  setNoteVisibility(workspaceId: string, noteId: string, visibility: string) {
    return this.request<unknown>(
      "PATCH",
      `/workspaces/${workspaceId}/notes/${noteId}/visibility/${visibility}`,
    );
  }

  setNotePin(workspaceId: string, noteId: string, pinned: boolean) {
    return this.request<unknown>(
      "PATCH",
      `/workspaces/${workspaceId}/notes/${noteId}/pin/${pinned}`,
    );
  }

  // ---- Comments ----

  listComments(workspaceId: string, noteId: string) {
    return this.request<unknown>(
      "GET",
      `/workspaces/${workspaceId}/notes/${noteId}/comments`,
    );
  }

  createComment(
    workspaceId: string,
    noteId: string,
    body: { body: string; thread_id?: string; quoted_text?: string },
  ) {
    return this.request<{ id: string; thread_id: string }>(
      "POST",
      `/workspaces/${workspaceId}/notes/${noteId}/comments`,
      { body },
    );
  }

  updateComment(workspaceId: string, noteId: string, commentId: string, body: { body: string }) {
    return this.request<unknown>(
      "PUT",
      `/workspaces/${workspaceId}/notes/${noteId}/comments/${commentId}`,
      { body },
    );
  }

  deleteComment(workspaceId: string, noteId: string, commentId: string) {
    return this.request<unknown>(
      "DELETE",
      `/workspaces/${workspaceId}/notes/${noteId}/comments/${commentId}`,
    );
  }

  // ---- Views ----

  listViews(workspaceId: string, params: { type?: string; noteId?: string } = {}) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/views`, { query: params });
  }

  getView(workspaceId: string, viewId: string) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/views/${viewId}`);
  }

  createView(
    workspaceId: string,
    body: { name: string; type: string; noteId?: string; data?: unknown; visibility?: string },
  ) {
    return this.request<unknown>("POST", `/workspaces/${workspaceId}/views`, { body });
  }

  updateView(workspaceId: string, viewId: string, body: { name?: string; data?: unknown }) {
    return this.request<unknown>("PUT", `/workspaces/${workspaceId}/views/${viewId}`, { body });
  }

  deleteView(workspaceId: string, viewId: string) {
    return this.request<unknown>("DELETE", `/workspaces/${workspaceId}/views/${viewId}`);
  }

  setViewVisibility(workspaceId: string, viewId: string, visibility: string) {
    return this.request<unknown>(
      "PATCH",
      `/workspaces/${workspaceId}/views/${viewId}/visibility/${visibility}`,
    );
  }

  // ---- View objects ----

  listViewObjects(workspaceId: string, viewId: string) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/views/${viewId}/objects`);
  }

  createViewObject(
    workspaceId: string,
    viewId: string,
    body: { name: string; type: string; data: unknown },
  ) {
    return this.request<unknown>("POST", `/workspaces/${workspaceId}/views/${viewId}/objects`, {
      body,
    });
  }

  updateViewObject(
    workspaceId: string,
    viewId: string,
    objectId: string,
    body: { name?: string; data?: unknown },
  ) {
    return this.request<unknown>(
      "PUT",
      `/workspaces/${workspaceId}/views/${viewId}/objects/${objectId}`,
      { body },
    );
  }

  deleteViewObject(workspaceId: string, viewId: string, objectId: string) {
    return this.request<unknown>(
      "DELETE",
      `/workspaces/${workspaceId}/views/${viewId}/objects/${objectId}`,
    );
  }

  // ---- Stats ----

  getNoteCountsByDate(workspaceId: string, days: number, timezoneOffset: number) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/stats/note-counts-by-date`, {
      query: { days, timezoneOffset },
    });
  }

  // ---- Workflows ----

  listWorkflows(workspaceId: string) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/workflows`);
  }

  getWorkflow(workspaceId: string, workflowId: string) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/workflows/${workflowId}`);
  }

  createWorkflow(workspaceId: string, body: { name: string; definition: string }) {
    return this.request<unknown>("POST", `/workspaces/${workspaceId}/workflows`, { body });
  }

  updateWorkflow(
    workspaceId: string,
    workflowId: string,
    body: { name?: string; definition?: string },
  ) {
    return this.request<unknown>(
      "PUT",
      `/workspaces/${workspaceId}/workflows/${workflowId}`,
      { body },
    );
  }

  deleteWorkflow(workspaceId: string, workflowId: string) {
    return this.request<unknown>("DELETE", `/workspaces/${workspaceId}/workflows/${workflowId}`);
  }

  setWorkflowEnabled(workspaceId: string, workflowId: string, enabled: boolean) {
    return this.request<unknown>(
      "PATCH",
      `/workspaces/${workspaceId}/workflows/${workflowId}/enabled`,
      { body: { enabled } },
    );
  }

  dispatchWorkflow(workspaceId: string, workflowId: string, inputs: Record<string, string> = {}) {
    return this.request<unknown>(
      "POST",
      `/workspaces/${workspaceId}/workflows/${workflowId}/dispatch`,
      { body: { inputs } },
    );
  }

  listWorkflowRuns(workspaceId: string, workflowId: string, page = 1, pageSize = 20) {
    return this.request<unknown>(
      "GET",
      `/workspaces/${workspaceId}/workflows/${workflowId}/runs`,
      { query: { page, page_size: pageSize } },
    );
  }

  getWorkflowRun(workspaceId: string, runId: string) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/runs/${runId}`);
  }

  getWorkflowJobLogs(workspaceId: string, runId: string, jobId: string, after?: number) {
    return this.request<unknown>(
      "GET",
      `/workspaces/${workspaceId}/runs/${runId}/jobs/${jobId}/logs`,
      { query: { after } },
    );
  }

  cancelWorkflowRun(workspaceId: string, runId: string) {
    return this.request<unknown>("POST", `/workspaces/${workspaceId}/runs/${runId}/cancel`);
  }

  listWorkflowVars(workspaceId: string) {
    return this.request<unknown>("GET", `/workspaces/${workspaceId}/vars`);
  }

  createWorkflowVar(workspaceId: string, key: string, value: string) {
    return this.request<unknown>("POST", `/workspaces/${workspaceId}/vars`, {
      body: { key, value },
    });
  }

  updateWorkflowVar(workspaceId: string, key: string, value: string) {
    return this.request<unknown>("PUT", `/workspaces/${workspaceId}/vars/${key}`, {
      body: { value },
    });
  }

  deleteWorkflowVar(workspaceId: string, key: string) {
    return this.request<unknown>("DELETE", `/workspaces/${workspaceId}/vars/${key}`);
  }
}
