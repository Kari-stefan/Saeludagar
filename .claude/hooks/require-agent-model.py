#!/usr/bin/env python3
"""PreToolUse hook for the Agent tool: every subagent launch must name its model.

It enforces the "Model routing" section of CLAUDE.md. Claude Code sends the tool
call as JSON on stdin. Exit code 2 blocks the call and shows stderr to the agent
as the reason. Exit code 0 allows it.
"""

import json
import sys

ALLOW = 0
BLOCK = 2


def main():
    try:
        # Read bytes: on Windows a piped stdin is not decoded as UTF-8 by default.
        call = json.loads(sys.stdin.buffer.read())
        tool_input = call["tool_input"]
        if not isinstance(tool_input, dict):
            raise TypeError("tool_input is not an object")
    except Exception as error:
        # A fault in the input or in this hook must never stop all work.
        print(
            "require-agent-model: could not read the hook input "
            f"({type(error).__name__}: {error}); the call is allowed.",
            file=sys.stderr,
        )
        return ALLOW

    if tool_input.get("subagent_type") == "fork":
        print(
            'Blocked: subagent_type "fork" ignores the model override and runs on '
            'the main model. Start a fresh agent and set model to "sonnet" or '
            '"opus" (see "Model routing" in CLAUDE.md).',
            file=sys.stderr,
        )
        return BLOCK

    model = tool_input.get("model")
    if not isinstance(model, str) or not model.strip():
        print(
            'Blocked: this Agent call has no model. Add model: "sonnet" (the '
            'default) or "opus" (work that needs judgment), as "Model routing" '
            "in CLAUDE.md describes.",
            file=sys.stderr,
        )
        return BLOCK

    return ALLOW


sys.exit(main())
