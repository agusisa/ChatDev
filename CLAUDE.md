# ChatDev 2.0 (DevAll) — Claude Code Reference

Zero-code multi-agent orchestration platform. Users define agent workflows visually or via YAML; the backend executes them against any OpenAI-compatible LLM.

---

## Project Structure

```
ChatDev/
├── server/              # FastAPI backend (REST + WebSocket)
├── runtime/             # Agent abstraction, tool execution, providers
│   └── node/agent/providers/
│       ├── openai_provider.py   # Handles OpenAI + Anthropic (compat layer)
│       └── gemini_provider.py   # Google Gemini (google-genai SDK)
├── workflow/            # Multi-agent orchestration logic (DAG + loop execution)
├── entity/              # Data models (Message, Graph, Node, Edge, etc.)
├── functions/
│   ├── function_calling/    # Built-in agent tools
│   └── edge_processor/      # Built-in edge payload processors
├── frontend/            # Vue 3 + Vite web console (port 5173)
├── yaml_instance/       # All workflow YAML configs (source of truth)
├── yaml_template/       # Schema/template reference for YAML authoring
├── schema_registry/     # JSON schema for workflow validation
├── tools/               # CLI utilities (sync, validate)
├── WareHouse/           # Runtime output — one folder per session (gitignored)
├── server_main.py       # Backend entrypoint
├── compose.yml          # Docker Compose (backend + frontend)
├── Dockerfile           # Backend multi-stage image (python:3.12-slim + uv)
├── frontend/Dockerfile  # Frontend image (node:24-alpine)
├── .env                 # Local secrets — NOT committed
├── .env.docker          # Docker-specific overrides (committed, no secrets)
└── .env.example         # Template for .env
```

---

## Running the App

### Docker (current setup — recommended)

```bash
docker compose up --build   # First time or after dependency changes
docker compose up           # Subsequent starts
docker compose down         # Stop
docker compose down -v      # Stop + wipe volumes (resets DB)
docker compose logs -f      # Live logs (both services)
docker compose logs backend --tail=100
docker compose restart backend   # After editing Python source or adding tools
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:6400

### Local (without Docker)

```bash
uv sync                          # Install Python deps
cd frontend && npm install        # Install JS deps

# In two terminals:
uv run python server_main.py --port 6400 --reload
cd frontend && VITE_API_BASE_URL=http://localhost:6400 npm run dev
```

### Make Commands

| Command | What it does |
|---|---|
| `make dev` | Start backend + frontend locally (parallel) |
| `make stop` | Kill ports 6400 and 5173 |
| `make sync` | Upload all `yaml_instance/` workflows to the DB |
| `make validate-yamls` | Syntax + schema check all YAML files |
| `make backend-tests` | Run pytest |
| `make backend-lint` | Run ruff |

---

## Environment Variables

File: `.env` (project root — never commit)

```env
# LLM Provider — current setup uses Anthropic via OpenAI compat layer
BASE_URL=https://api.anthropic.com/v1
API_KEY=sk-ant-...
MODEL_NAME=claude-haiku-4-5-20251001
```

Workflows reference these as `${BASE_URL}`, `${API_KEY}`, `${MODEL_NAME}`.

**To switch model:** edit `MODEL_NAME` in `.env`, then `docker compose restart backend`.

| Provider | BASE_URL | Notes |
|---|---|---|
| Anthropic | `https://api.anthropic.com/v1` | Uses OpenAI compat; chat completions only |
| OpenAI | `https://api.openai.com/v1` | Full Responses API support |
| LM Studio | `http://localhost:1234/v1` | Local |
| Ollama | `http://localhost:11434/v1` | Local |

**Other optional vars:**
```env
SERPER_DEV_API_KEY=...   # web_search tool
JINA_API_KEY=...         # read_webpage tool
```

**Docker-specific** (`.env.docker` — committed, no secrets):
```env
BACKEND_BIND=0.0.0.0
VITE_API_BASE_URL=http://backend:6400   # Inter-container routing via Vite proxy
CORS_ALLOW_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

---

## Workflow YAML Reference

All workflows live in `yaml_instance/`. After adding or editing files run `make sync` or restart the backend.

### Minimal Structure

```yaml
version: 0.0.0
vars:
  CUSTOM_VAR: "value"      # Optional — overrides .env
graph:
  id: my_workflow
  description: "What this does"
  start:
    - EntryNodeId
  nodes:
    - id: EntryNodeId
      type: agent
      context_window: -1
      config:
        name: ${MODEL_NAME}
        provider: openai        # Always "openai" — works for Anthropic too
        base_url: ${BASE_URL}
        api_key: ${API_KEY}
        role: |
          You are ...
        params:
          temperature: 0.7
          max_output_tokens: 4096
  edges:
    - from: EntryNodeId
      to: AnotherNodeId
```

### Node Types

| Type | Key config fields | Notes |
|---|---|---|
| `agent` | `name`, `provider`, `base_url`, `api_key`, `role`, `params`, `tooling`, `context_window` | Core LLM node |
| `human` | `description` | Pauses workflow, waits for user input |
| `python` | `timeout_seconds` | Extracts ```python``` block from input and runs it in `code_workspace/` |
| `passthrough` | `only_last_message` (bool) | Passes messages through; default passes only last |
| `literal` | `message`, `role` | Outputs fixed text, ignores input |
| `loop_counter` | `max_iterations`, `reset_on_emit` | Outputs only when counter hits max |
| `subgraph` | `source_type` (`file`\|`config`), `file_path` | Embeds another workflow |

### Edge Configuration

```yaml
edges:
  - from: NodeA
    to: NodeB
    config:
      trigger: true               # Trigger target node (default true)
      pass_data: true             # Pass data to target (default true)
      keep_message_input: false   # Mark messages as kept (survive context clear)
      clear_context: false        # Clear non-kept history in target
      condition:
        type: keyword             # "keyword" | "function"
        keyword: "ACCEPT"         # Edge active only if message contains this
      payload_processor:
        type: regex_extract       # or "function"
        pattern: "```python(.+?)```"
```

### context_window on nodes

| Value | Behaviour |
|---|---|
| `-1` | Keep all messages |
| `0` | Clear all (except kept) |
| `N > 0` | Keep newest N messages |

---

## Adding Custom Tools

Drop a `.py` file in `functions/function_calling/`:

```python
from typing import Annotated
from utils.function_catalog import ParamMeta

def my_tool(
    param: Annotated[str, ParamMeta(description="what this does")],
    *,
    _context: dict | None = None,   # injected by system, not exposed to LLM
) -> str:
    """Description shown to the LLM"""
    return "result"
```

Reference in agent node YAML:
```yaml
tooling:
  - type: function
    config:
      tools:
        - name: my_file:my_tool     # filename (no .py) : function_name
        - name: my_file:All         # all functions in the file
```

Restart backend after adding: `docker compose restart backend`

### Built-in Tools

| Module | Key functions |
|---|---|
| `file.py` | `save_file`, `load_file`, `list_directory`, `search_in_files` |
| `uv_related.py` | `install_python_packages`, `uv_run`, `init_python_env` |
| `web.py` | `web_search`, `read_webpage_content` |
| `deep_research.py` | `search_save_result`, report generation series |
| `video.py` | `render_manim`, `concat_videos` |
| `code_executor.py` | `execute_code` |
| `user.py` | `call_user` |
| `weather.py` | weather lookup |

---

## Adding Custom Edge Processors

Drop a `.py` file in `functions/edge_processor/`:

```python
from typing import Dict, Any

def my_processor(data: str, _context: Dict[str, Any]) -> str:
    """Description"""
    return data.upper()
```

---

## Adding Custom Edge Conditions

Drop a `.py` file in `functions/edge/`:

```python
def my_condition(message_text: str) -> bool:
    return "DONE" in message_text
```

---

## Workflow Inventory (`yaml_instance/`)

### Full Workflows
| File | Description |
|---|---|
| `ChatDev_v1.yaml` | Classic virtual software company (CEO, CTO, Programmer, Reviewer) |
| `GameDev_with_manager.yaml` | Game development with a manager agent |
| `MACNet_v1.yaml` | Multi-agent collaboration network |
| `deep_research_v1.yaml` | Deep research with web search + report generation |
| `data_visualization_basic.yaml` | CSV → charts |
| `data_visualization_enhanced_v2/v3.yaml` | Enhanced data vis |
| `blender_3d_builder_*.yaml` | 3D generation via Blender MCP (requires Blender) |
| `teach_video.yaml` | Educational video with Manim (requires `uv add manim`) |
| `react.yaml` | ReAct reasoning loop |
| `reflexion_product.yaml` | Reflexion self-improvement loop |
| `general_problem_solving_team.yaml` | General multi-agent team |

### Demo / Feature Files (`demo_*.yaml`)
`demo_code`, `demo_human`, `demo_dynamic`, `demo_dynamic_tree`, `demo_function_call`, `demo_loop_counter`, `demo_majority_voting`, `demo_mcp`, `demo_simple_memory`, `demo_file_memory`, `demo_improved_memory`, `demo_mem0_memory`, `demo_sub_graph`, `demo_edge_transform`, `demo_context_reset`

### Subgraphs (`subgraphs/`)
Reusable sub-workflows: `article_discuss.yaml`, `react_agent.yaml`, `reflexion_loop.yaml`, `MACNet_Node_sub.yaml`, `MACNet_optimize_sub.yaml`

---

## Session Output (`WareHouse/<session>/`)

| File | Contents |
|---|---|
| `execution_logs.json` | Full step-by-step execution log |
| `node_outputs.yaml` | Per-node output records |
| `token_usage_<session>.json` | Token counts per node |
| `workflow_summary.yaml` | High-level run summary |
| `code_workspace/` | Python node working dir |
| `code_workspace/attachments/` | User-uploaded files |

---

## LLM Provider Notes

The backend uses the **OpenAI Python SDK** for all non-Gemini models. When `BASE_URL` points to Anthropic:
- Falls back to Chat Completions API (Responses API not supported by Anthropic compat layer)
- Set `protocol: chat` in agent `params` to force chat mode explicitly
- Tool calling works normally

For Gemini workflows (image generation, multimodal): use `provider: gemini` with `BASE_URL` pointing to Google. Those workflows are not affected by `MODEL_NAME`.

---

## Key Decisions Made in This Session

- **Model**: `claude-haiku-4-5-20251001` via Anthropic's OpenAI-compatible endpoint
- **All workflow YAMLs**: replaced hardcoded `gpt-4o` / `gpt-4o-mini` / `gpt-4-turbo` with `${MODEL_NAME}`
- **Gemini workflows** (`blender_*`, image gen): left untouched — they require Gemini
- **Running via Docker Compose**: both services containerized with live bind-mount volumes for hot reload
