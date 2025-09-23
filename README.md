# Vector Copilot

This repository contains the source code for Vector, a copilot for Roblox Studio. It helps developers write code, manipulate objects, and interact with the Roblox environment using natural language.

The system is composed of two main parts:
- A **Roblox Studio Plugin** that provides the user interface and integrates with the Studio environment.
- A **Next.js Web Backend** that handles the core logic, communicates with large language models, and manages the workflow.

## Architecture

The following diagram illustrates the architecture of the system:

```mermaid
graph TD
    subgraph "Roblox Studio Environment"
        direction LR
        subgraph "Vector Plugin (Lua)"
            direction TB
            PluginUI["Dockable UI (main.server.lua)"]
            PluginCore["Core Logic (main.server.lua)"]
            PluginHTTP["HTTP Client (net/http.lua)"]
            PluginTools["Tools (tools/*.lua)"]

            PluginUI --> PluginCore
            PluginCore --> PluginHTTP
            PluginCore --> PluginTools
        end

        subgraph "Roblox Studio APIs"
            direction TB
            StudioAPI["StudioService, ScriptEditorService, etc."]
        end

        PluginTools --> StudioAPI
    end

    subgraph "Web Backend (Next.js)"
        direction TB
        APIRoutes["API Routes (app/api/)"]
        Orchestrator["Orchestrator (lib/orchestrator)"]
        LLMProviders["LLM Providers (lib/orchestrator/providers)"]
        Lib["Supporting Libraries (lib/*)"]

        APIRoutes --> Orchestrator
        Orchestrator --> LLMProviders
        Orchestrator --> Lib
    end

    subgraph "External Services"
        LLM["Large Language Models (OpenAI, Gemini, etc.)"]
    end

    PluginHTTP -- "JSON API Requests" --> APIRoutes
    APIRoutes -- "Streaming Responses" --> PluginHTTP
    LLMProviders -- "Model Invocations" --> LLM

end
```
