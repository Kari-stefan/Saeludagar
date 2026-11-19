// PreToolUse hook for the Agent tool: every subagent launch must name its model.
//
// It enforces the "Model routing" section of CLAUDE.md. Claude Code sends the tool
// call as JSON on stdin. Exit code 2 blocks the call and shows stderr to the agent
// as the reason. Exit code 0 allows it.

const ALLOW = 0;
const BLOCK = 2;

async function main() {
  let toolInput;
  try {
    // Read bytes and decode as UTF-8: a piped stdin is not always decoded as UTF-8.
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const call = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    toolInput = call.tool_input;
    if (toolInput === null || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
      throw new TypeError('tool_input is not an object');
    }
  } catch (error) {
    // A fault in the input or in this hook must never stop all work.
    const name = error && error.name ? error.name : 'Error';
    const message = error && error.message ? error.message : String(error);
    process.stderr.write(
      'require-agent-model: could not read the hook input '
        + `(${name}: ${message}); the call is allowed.\n`,
    );
    return ALLOW;
  }

  if (toolInput.subagent_type === 'fork') {
    process.stderr.write(
      'Blocked: subagent_type "fork" ignores the model override and runs on '
        + 'the main model. Start a fresh agent and set model to "sonnet" or '
        + '"opus" (see "Model routing" in CLAUDE.md).\n',
    );
    return BLOCK;
  }

  const model = toolInput.model;
  if (typeof model !== 'string' || model.trim() === '') {
    process.stderr.write(
      'Blocked: this Agent call has no model. Add model: "sonnet" (the '
        + 'default) or "opus" (work that needs judgment), as "Model routing" '
        + 'in CLAUDE.md describes.\n',
    );
    return BLOCK;
  }

  return ALLOW;
}

process.exitCode = await main();
