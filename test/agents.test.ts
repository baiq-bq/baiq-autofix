import test from "node:test";
import assert from "node:assert/strict";

import { getAgent, isValidAgentType, DEFAULT_CODEX_MODEL, DEFAULT_AIDER_MODEL } from "../src/agents";

test("isValidAgentType returns true for 'codex'", () => {
  assert.equal(isValidAgentType("codex"), true);
});

test("isValidAgentType returns true for 'aider'", () => {
  assert.equal(isValidAgentType("aider"), true);
});

test("isValidAgentType returns false for invalid agent types", () => {
  assert.equal(isValidAgentType("invalid"), false);
  assert.equal(isValidAgentType(""), false);
  assert.equal(isValidAgentType("CODEX"), false);
  assert.equal(isValidAgentType("AIDER"), false);
});

test("getAgent returns codex agent for 'codex'", () => {
  const agent = getAgent("codex");
  assert.equal(agent.name, "codex");
  assert.equal(typeof agent.install, "function");
  assert.equal(typeof agent.run, "function");
});

test("getAgent returns aider agent for 'aider'", () => {
  const agent = getAgent("aider");
  assert.equal(agent.name, "aider");
  assert.equal(typeof agent.install, "function");
  assert.equal(typeof agent.run, "function");
});

test("getAgent throws for invalid agent type", () => {
  assert.throws(
    () => {
      // @ts-expect-error - testing invalid input
      getAgent("invalid");
    },
    { message: /Unknown agent type/ }
  );
});

test("DEFAULT_CODEX_MODEL is gpt-5-codex", () => {
  assert.equal(DEFAULT_CODEX_MODEL, "gpt-5-codex");
});

test("DEFAULT_AIDER_MODEL is gpt-4o", () => {
  assert.equal(DEFAULT_AIDER_MODEL, "gpt-4o");
});

// Test agent isolation - codex and aider are independent
test("codex and aider agents are distinct objects", () => {
  const codex = getAgent("codex");
  const aider = getAgent("aider");
  assert.notEqual(codex, aider);
  assert.notEqual(codex.name, aider.name);
});
